# ADR 0012 — What the agent reaches happens in a microVM

Status: accepted, engine verified on Linux/KVM, built
Date: 2026-10-06

## The decision

**One microVM per workspace, microsandbox as the engine.** Everything the model touches goes
through it: commands, file reads, file writes, and the workspace's own resource files
(`AGENTS.md`, `.agents/`, skills, commands, agents). The worker stays outside the sandbox, on
the host, next to the provider credential — and it has **no host-side path to the workspace at
all**. If the worker could read, write, or run anything in the workspace without going through
the sandbox, the sandbox would be decoration.

Two ways in, one engine:

| | who | how | why |
|---|---|---|---|
| lifecycle | control (Go) | the engine's **command line** | no engine SDK for Go; create/start/stop/remove is all shell-shaped |
| execution | the worker (bun) | the engine's **SDK** | only the SDK streams; only the SDK can kill a command |

Measured, because it decides the split: the CLI's first output chunk arrives at **+3037ms**
(everything at exit), the SDK's at **+31ms**. Killing a host-side CLI `exec` leaves the guest
process running; the SDK's `kill()` left **0**. They drive the same engine and the same state —
the SDK lists and attaches to sandboxes the CLI created, verified both ways.

The friendly consequence: control stays plain Go, and the worker's execution path is one
adapter. The two sides agree on the engine by construction: control passes the driver's name to
the worker, and the worker refuses an engine it does not implement.

## The engine is a seam, not a dependency

Nothing above the seam names microsandbox:

- `gateway/internal/sandbox`: `Driver` — install, usable, list, create, start, stop, remove, and
  the environment a worker needs to find the same state. `Manager` owns the lifecycle and the
  refusal policy; `Microsandbox` implements the interface in one file. A second engine is a
  second file there.
- `worker/src/sandbox.ts`: `SandboxClient` — exec and file operations, and nothing else.
  `microsandbox.ts` is the only file that imports the SDK. `sandbox-env.ts` turns any
  `SandboxClient` into the harness's `ExecutionEnv`.

## The policy

One generated file per workspace, plus the flags the file cannot express:

```yaml
image: debian:stable-slim   # the project's environment, not ours
cpus: 2
memory: 2G
network: none               # omitted means egress is allowed — see below
idle_timeout: 30m           # a sandbox nobody used stops itself
mounts:
  - /home/me/work:/home/me/work:uid=1000,gid=1000
  - /home/me/.agents:/home/me/.agents:ro
  - /home/me/.acornfall/skills:/home/me/.acornfall/skills:ro
```

Egress **defaults on** for a new workspace and is a per-workspace switch (on/off only, for now),
settable in the interface or with `acornfall workspace add --network off`. The image is the
project's environment — a `golang:` image, a `rust:` image, a devcontainer-style one — and
settable with `--image`. Bun is the *worker's* runtime and has no business in the guest.

The workspace is mounted read-write **at its own path**, so a path in the model's world and in
the user's world are the same string and no translation exists anywhere. The global resource
folders are mounted read-only at theirs for the same reason
([ADR 0014](0014-global-resources-in-the-sandbox.md)). Those mounts are the only doors into
the host; the worker is not on the host side of any of them.

`acornfall workspace list` shows what each workspace will run in; the policy file is written
next to the workspace's state, so a person can read what it is allowed to be.

## What the worker can and cannot see

| in the worker (host, next to the key) | in the sandbox (the model's reach) |
|---|---|
| the protocol to the gateway | every command (`bash`, `sed`, `grep`, `git`, …) |
| the model call, with the provider key | every file read or written through a tool |
| its own storage: `<home>/state/<ws>` | the workspace's resource files |
| global resources: `~/.agents`, `<home>` | the global resource folders: `~/.agents` and the install's agents, skills, and prompts, read-only |
| deciding tool calls, evaluating guards, spawning subagents | anything those commands create |

None of what the worker holds is mounted into the sandbox: `<home>/credentials.json` and
`<home>/state` are not paths that exist inside it, and the global resources are there only
because a skill's instructions name their own directory and the script beside them has to
run — read-only, so the instructions cannot be rewritten from inside
([ADR 0014](0014-global-resources-in-the-sandbox.md)).

Reads are routed per path (`worker/src/files.ts`): under the workspace they go to the sandbox,
elsewhere to the host. The user's own folders are the host's business; the workspace's are the
sandbox's.

A message is text: there is no file or image attachment yet. When one arrives, its bytes are
the sandbox's business — the client and the gateway never hand the worker a host path into a
workspace, and nothing here should change that.

## Refusal

**There is no fallback.** When the engine or the hypervisor is missing, the tools refuse —
naming what is missing — and the state frame says so (`sandbox.tools: false`,
`sandbox.problem`), which the interface shows. The worker starts anyway, because a workspace
whose tools refuse is still a workspace: its conversations, its history, and its settings are
all readable. Running unconfined must be a decision somebody made, never a state the system
drifted into. The decision is a separate engine, `--sandbox-engine host`: it is chosen by name,
never by a missing hypervisor, and every surface reports that it is not isolated
([ADR 0015](0015-host-engine.md)).

`acornfall doctor` reports the tier without changing anything: engine, version, install path,
state path, and the reason it cannot work if it cannot.

## Known limits, deferred on purpose

- **With egress on, anything in the workspace can leave.** A command inside can read `.env` and
  post it anywhere. The agent is *supposed* to have the workspace, so this is "it can leak what
  it can already read", but it is a real exposure and the narrowing is an egress allowlist.
- **With egress on, the gateway's own API is reachable from inside.** The guest sits on
  `172.16.0.10/30` with the host at `172.16.0.9`, so it can reach whatever the host can reach —
  the LAN, the tailnet, and, with `--insecure`, an unauthenticated API to every other workspace.
  Take this up later; it is the strongest argument for the allowlist.
- **macOS gives a Linux/arm64 guest.** Mach-O binaries cannot run inside it, so no Xcode, no
  Swift or Objective-C builds, no Homebrew tools, no iOS simulators — those stay on the host or
  do not happen. Node, Python, Go, Rust, Ruby work normally, installing their own Linux
  dependencies inside the guest. **Unverified on Apple Silicon**: the engine publishes
  `darwin-arm64`; nobody has run it here.
- **The state folder has to be short.** The engine's runtime sockets live under its state
  directory and a Unix socket path is limited to 108 bytes, most of which the engine's own
  layout eats: measured, 46 characters works and 56 does not, whatever the sandbox is called.
  `--sandbox-state` exists for this, and the driver refuses with a sentence naming the limit
  rather than passing the engine's error through. The default `<home>/sandboxes` is 33 here.
- **The first image comes from a registry.** Anonymous Docker Hub pulls are rate limited per
  address, and a fresh state directory means a fresh pull. `msb save` / `load` move an image
  between state directories, which is how a machine without a registry (or with a spent limit)
  can still be set up.
- **Not doing now, on purpose:** private volumes over build directories. A sandbox's
  `node_modules` is Linux ELF, so it differs from a host's; shadowing those paths with
  `--mount-owned` keeps the two from fighting. It only matters when the host also builds in the
  same folder (always, on macOS), it is one flag, and it comes back when it bites.

## What the spike showed

| | |
|---|---|
| boot a fresh sandbox | 259 ms |
| start a stopped one | 192 ms |
| two 3s commands at once | 3036 ms — parallel |
| first output chunk, CLI / SDK | +3037 ms / **+31 ms** |
| leftover guest processes after killing a command, CLI / SDK | 1 / **0** |
| exit codes | preserved both ways |
| workspace mount | live both directions, files owned by the host user |
| `network: none` | egress denied; omitted means allowed |
| inside the guest | `/home` empty, no host state, no credentials |
| installed engine | 67 MB, `checksums.sha256` verified on first use |

## What changed in the code

- `internal/sandbox`: the policy, the driver seam, the engine install (release bundle plus
  checksum, unpacked beside its final name), the lifecycle, and the refusal.
- `internal/control`: a workspace's sandbox is created before its worker starts, stopped when
  the workspace is evicted, removed with the workspace. `state.sandbox` says what the tools can
  reach. `--sandbox-state` moves the engine's store.
- The worker: `SandboxClient` and its engine adapter, `SandboxExecutionEnv` for every tool call,
  and resource loading routed through the sandbox. `--sandbox <name>` and
  `--sandbox-engine <engine>` come from control; without them the tools refuse.
- `acornfall doctor` and the workspace CLI (`--image`, `--network`).
- Tests: the environment, the routing, and the refusal are unit-tested against a fake sandbox,
  so the ordinary suite needs no hypervisor. The end-to-end tests that exercise a real
  workspace run a real microVM and belong to the slow tier, `make test-sandbox`, which fails
  rather than skips where there is no hypervisor. `make test` forces the refusal path with
  `ACORNFALL_NO_SANDBOX=1` instead of auto-detecting the machine, so the fast gate behaves the
  same everywhere. Each test removes the sandboxes it created, named from the workspaces it
  owns; the image cache is shared across the suite, which is also what keeps it inside a
  registry's rate limit. [ADR 0013](0013-test-tiers.md) records the tiers.
