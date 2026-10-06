# ADR 0012 — What the agent runs happens in a microVM

Status: accepted, engine verified on Linux/KVM, not built yet
Date: 2026-10-06

## The decision

**One microVM per workspace, microsandbox as the engine, the workspace as the only mount, no
network.** Everything the model asks to *run* runs inside it. The worker stays outside it, on
the host, because it holds the provider credential.

The policy for a workspace is one generated file, and it is the whole policy:

```yaml
image: alpine            # the workspace's base image (see "Images" below)
cpus: 2
memory: 1G
network: none            # the model call happens on the host, so the VM needs no egress
idle_timeout: 30m        # a sandbox nobody used stops itself
mounts:
  - /home/me/work:/home/me/work:uid=1000,gid=1000
```

Verified on this machine, not assumed: the workspace mount is live in both directions (a guest
write lands on the host disk as uid 1000, a host write appears in the guest), `/home` inside
the guest is empty, `~/.acornfall/credentials.json` and `state/` do not exist as paths there,
`network: none` denies egress, commands run in parallel, exit codes cross the boundary, and
files written by one `exec` are there for the next.

## Why

Until now a workspace's `bash` could read the user's home, the provider credential, and every
other workspace's storage. The trust flag closed the *instruction* channel and left reach wide
open — see ADR 0011, "Trust, and why it went". This closes reach.

The mount is the whole trick: the workspace is mounted **at its own path**, so a path in the
model's world and in the user's world are the same string, the user watches edits land in the
editor they already have open, and we need no path translation anywhere. Everything the model
should be able to touch is in that one folder, and everything it should not be able to touch
simply is not a path inside the VM.

## Why the worker stays outside

Three reasons, in order of weight:

1. **The credential.** The worker holds the provider key and talks to the model. Put the worker
   inside and the key must come with it — readable by exactly the code the sandbox exists to
   contain — or the model calls must be proxied through a host-side broker. That broker is a
   real design (it is what OpenShell is), and it is a later one.
2. **The protocol.** Our worker protocol is JSONL over a pipe, long-lived and streaming. The
   engine CLI's transport is request/response: stdin streams, but stdout is collected until the
   command exits (measured). The SDK talks vsock and `msb ssh` streams, so it could be done —
   the point is that it buys nothing, because the worker's own work outside its tools is never
   model-controlled.
3. **`bash` is the only thing that can do arbitrary damage.** The harness's file tools take
   paths, and the guards already police those. Shell execution is the unbounded one.

So: the workspace is shared, the worker keeps its pipes, and only `exec` crosses the boundary.
A consequence worth stating: with the worker on the host, **nothing needs to be installed
inside the VM but the user's own toolchain** — bun does not have to exist in the sandbox, and
the "compile the worker into a single binary" question stops being a sandbox requirement.

## What is confined, and what is not

**Confined:** anything the model asks to run. Inside the VM there is a stock image and the
workspace, and that is all. A shell that reads `/home` finds nothing, and there is no path to
the provider key, the session database, the resource bundles, or another workspace.

**Not confined: the harness's file tools.** `read`, `write`, `edit`, `grep`, and `glob` are
node fs calls in the worker process, and they can name any path the user can read. Saying this
plainly is the point of this section; the options are:

- register our own file tools that go through the engine (`msb exec cat`, `msb copy`) so every
  model-driven byte moves inside the VM, where the workspace is the only reachable path;
- or keep them on the host and lean on workspace rules that deny paths outside the root — which
  is policy, not plumbing, and a symlink inside the workspace defeats it.

The first is the honest fix and it is a follow-up, not a prerequisite: shell execution is where
the damage was, and this ADR is about that.

## The engine, and why this one

microsandbox: libkrun microVMs, Apache-2.0, a CLI with the whole lifecycle we need
(`create`, `start`, `stop`, `exec`, `copy`, `snapshot`, `restore`, `fork`, `modify`, `status`,
`wait`, `ping`, `metrics`, `logs`, `rm`), a `sandbox.yaml` that is exactly the policy file
above, host-directory mounts with uid mapping, snapshots and CoW forks, and a documented
download with a published `checksums.sha256`. `msb doctor` exists for the diagnosis path.

Engines stay pluggable behind our policy: what acornfall stores per workspace is *intent*
(image, limits, mounts, egress), and an engine adapter turns that into `sandbox.yaml`, a
`bwrap` invocation, or whatever comes next. Nothing above the adapter knows the word
microsandbox. bwrap is the fallback we know works on Linux (verified earlier: hidden `~`,
unreadable token, no network, still a usable shell) but it is Linux-only and a namespace
boundary rather than a hardware one, so it is not the tier. Docker is not the tier either: it
is a daemon we would be asking the user to install, and the boundary is the host kernel.

## Images

In order, as decided:

1. **Stock base image** (alpine, or an image the workspace asks for) plus the workspace mounted
   in. This is what ships first: no preparation step, no published artifact.
2. **First-run preparation and a snapshot**: the first time a workspace needs its own toolchain,
   install it, then snapshot the disk so later boots start from the prepared state. The engine
   supports this directly.
3. **A published OCI image built by CI** for workspaces whose environment should be identical
   everywhere and cached, not built.

## Distribution and refusal

The engine is acornfall's dependency, not the user's problem: on first use it is downloaded
into `<home>/tools/microsandbox/<version>` (the release bundle plus its `checksums.sha256`,
verified), its version and hypervisor state are reported by `doctor`, and its runtime state
lives in a directory acornfall owns so that uninstall is complete.

**If the engine or the hypervisor is missing, acornfall refuses to run tools.** It does not
quietly fall back to the host: "unconfined" must be a decision somebody made, never a state
the system drifted into. Whether there is a config knob that *grants* the fallback is
deliberately still open.

## What the spike showed

| | |
|---|---|
| boot a fresh sandbox | 259 ms |
| start a stopped one | 192 ms |
| two 3s commands at once | 3036 ms (parallel, not serialized) |
| exit code through `exec` | preserved |
| files written by one exec | visible to the next |
| guest kernel | 6.12.111 (host: 6.17.13-3-pve) — a real kernel, not a namespace |
| installed size | 67 MB (26 MB bundle + guest kernel) |
| state | `MSB_HOME`, default `~/.microsandbox` |

Two mechanics that shape the implementation:

- **stdin streams, stdout is collected until exit.** Fine for a command, fatal for a protocol —
  which is why the worker is not inside. Long-running commands therefore stream nothing until
  they finish, the same as today.
- **Killing the host-side `exec` does not kill the guest process.** Abort has to happen inside
  the VM: run each command with a marker and a pid file, and kill the process group by marker;
  `--timeout` is the backstop.

## What changes in the code

- `internal/sandbox`: the policy type, the engine adapter, first-use download and verification,
  `doctor` reporting. Control creates and starts one sandbox per workspace, stops it when the
  workspace is evicted, and removes it when the workspace is removed.
- The worker gets one seam: the `bash` tool runs its command through the engine instead of
  `spawn`, with the marker/abort mechanics above. Nothing else in the worker changes.
- `capabilities.sandbox` and the state frame say which engine is in use, so the interface can
  show it and a test can assert it.
- Tests: an e2e case that a workspace's shell cannot read a file planted outside the workspace
  (the failure the whole ADR exists to prevent), and one that a missing engine refuses rather
  than degrades.
