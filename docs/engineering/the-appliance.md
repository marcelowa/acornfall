# The appliance: how 0.10 runs

0.10 changed where the product runs. Before it, every workspace was a microVM on the host, each with
its own engine, its own catalog and its own copy of the runtime. After it, the host launches **one
machine per install**, and everything the product is — gateway, worker, containers — lives inside
that machine. ADR 0022 records the decision; this page records how it works, and what it cost to find
out.

## The model

```
host                                    the machine (one microVM per install)
────────────────────────────────────    ────────────────────────────────────────────────────────
~/acornfall            ← the mount ─────→ /acornfall/workspaces/…   the product's files
~/.acornfall/          the machinery     /var/lib/acornfall/         the appliance's own state
  appliance/rootfs       the image ─────→ PID 1 = the gateway
  tools/microsandbox/    the engine         └─ worker (bun) ─ lxc ─→ containers for tool calls
  sandboxes/<machine>    the disk
```

Three rules fall out of that picture and each one cost a bug to learn:

1. **The mount holds what the product is; `~/.acornfall` holds what runs it.** Deleting the second is
   a clean install. Deleting the first is losing the product's files.
2. **The appliance is the machine's disk.** It is not a container image the engine mounts: it is a
   rootfs tarball, unpacked onto a real filesystem, booted with the gateway as PID 1.
3. **The console and the containers are different sandboxes.** The console runs in the machine. Tools
   run in containers inside it, which have their own `/dev`, their own network and their own config.

## The pieces

| Piece | What it is | Where |
|---|---|---|
| appliance image | Debian-stable rootfs + the gateway binary + the worker sources and its production `node_modules` | built by `scripts/build-appliance.sh`, shipped as `appliance-linux-amd64.tar.gz` (~155 MB) |
| engine | microsandbox `0.7.6`, the hypervisor wrapper | fetched by the launcher, pinned per release |
| machine | one microVM, booted from the image, with the mount passed in | `acornfall-machine-<hash>` |
| gateway | PID 1 inside the machine, serves the console and the API | `--in-machine --sandbox-engine lxc` |
| worker | bun, the agent runtime, spawns the container engine | inside the machine |
| container | one per workspace, lxc, unprivileged by default | `acornfall-<workspace>-<hash>` |

The launcher (`machine up`) does four things and no more: fetch the image if the version is new, verify
it against the release's checksums, boot it, publish its port. Everything after that is the machine's.

## Boot, and why the gateway is PID 1

The engine has no entrypoint for a plain rootfs, so the launcher passes an interpreter and a script:

```
--init /bin/sh --init-arg -c --init-arg <script>
```

The script is where the machine's assumptions are made explicit, because an image is *files*, not a
running system:

- the appliance's `/dev` nodes are created (`null`, `zero`, `full`, `random`, `urandom`, `tty`) — an
  unpacker running as a user cannot create device nodes, so a tarball has none
- the gateway is started with `--in-machine`, which tells it the containers are the machine's own and
  the shim runs in-process over a `net.Pipe` instead of over a socket to a separate process
- the gateway binds `0.0.0.0:7777` *inside* the machine, because the engine's port forward cannot
  reach the guest's loopback; the host side stays on `127.0.0.1` unless `--host` says otherwise

## The container's two `/dev`s

This is the bug that took a day, so it is written as the rule it should have been:

- **the machine's `/dev`** is the image's `/dev`, filled in by the init script above
- **the container's `/dev`** is made by lxc: `lxc.autodev = 1` mounts a devtmpfs and creates the nodes,
  which is why `/dev/null` inside a container is owned by `nobody:nogroup`

Both can exist and `lxc-attach` can still fail: it opens `/dev/null` **before** it enters the
container's namespaces, so the open is subject to the **container's device cgroup**. With no
`lxc.cgroup2.devices.allow` list that open returns `EPERM`, lxc prints
`open_devnull: Operation not permitted`, and then runs the command anyway. Every working command
carried a line that read like the reason it could not run.

The fix is the allow list — `c 1:3` (null), `c 1:5`, `c 1:7`, `c 1:8`, `c 1:9`, `c 5:0..2`, `c 136:*`.
Filtering the message would have hidden a real permission denial.

## Lifecycle and the states that lie

`up` → `status` → `stop` → `down` → `restart`. The one that matters is `down`: it removes the
machine's disk, so the containers go with it. That is why it is also the repair for a machine whose
container will not start.

Four states have lied during this beta, each in a message that was true about something else:

| Message | What it actually meant |
|---|---|
| `open_devnull: Operation not permitted` | the container's device cgroup, not a missing node |
| `capabilities.sandbox: "local-process"` | a hardcoded string, while the container was running |
| `capabilities.sandbox: "microsandbox"` | the *store*'s engine name, not the driver's |
| `lxc-start: Received container state "ABORTING"` | the container was **already running**; a second start is an error |

The rule that comes out of it: **check the effect before believing the message.** `lxc-ls` said
RUNNING through all four.

## Resources

Ceilings and shares, never reservations:

- `memory.max = min(ask, machine memory / 2)`, `memory.high` at three quarters of that
- `cpu.weight = CPUs × 100`, proportional
- a container's default is unprivileged; a workspace can ask for the privileged profile, and both
  configs are pinned by tests because the differences between them are the point

## Release and CI

- `binaries` (4 platforms) → `appliance` (built inside a microVM, so the runner needs no root) → `publish` → `prove`
- `prove` boots the published tarball with the install's own code, and runs `machine up` with the
  published binary as an unprivileged runner user — the artefact proving itself before anyone installs it
- `prove.yml` runs the same boot on a branch push from the appliance the runner keeps on disk, so a
  fix is tested in minutes rather than a release cycle

Two known costs, both being worked: `publish` moves ~260 MB through artifact storage (the fix is a
draft release each job uploads to directly), and the appliance is stored as a 193 MiB artifact per
release, which a private repository's quota cannot hold for more than two.

## What is still open

- **image pollution**: the image is the machine's `/`, so a machine writes into the image it booted
  from. Either a copy per machine or an engine-side overlay.
- **engine/catalog conflict**: the Go side and the worker have shipped different engine versions, and
  a newer engine migrates the shared catalog beyond what the older one can read. One version across
  both layers, or a catalog per layer.
- **the sign-in stall**: the console can enter "Starting api key…" before anything is pasted. Needs a
  log from the moment it happens.
