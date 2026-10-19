# ADR 0022 — The appliance runs in the machine, the host is a launcher

Status: draft, not accepted — the owner's decisions of 2026-10-19, written down so they stop
being lost. Nothing here is built. [ADR 0021](0021-workspaces-as-lxc-containers.md) is the
machine this one moves the product into; this file is the bigger shape around it.
Date: 2026-10-19

## Context

Today the gateway and the worker run on the host ([ADR 0012](0012-sandbox.md): "the worker stays
outside the sandbox, on the host, next to the provider credential — and it has no host-side path
to the workspace at all"), and a sandbox is reached two ways: the engine's command line for the
lifecycle, its SDK for execution. The owner's words:

> console -> host -> vm -> workspace … my idea is that the gateway and the worker will run inside
> the vm … the provider key -> in the mount; product state -> in the mount

Building ADR 0021's machine showed what that split costs: the SDK is a native module per host
platform, the worker's bun has to be installed on the host, the command line is bad at execution
(a long install loses its session and leaves dpkg interrupted — measured), something inside the
machine had to own the containers' processes (the shim), and the engine's pin couples the gateway
and the worker through a store they share.

## Decision (proposed)

1. **One microVM per install** (ADR 0021), and the **whole appliance runs inside it**: the
   gateway, the worker, the container layer (lxc), and the workspaces as containers.
2. **The host is a launcher**: it ensures and boots the machine, publishes the one port the
   console uses, hands over nothing but the mount, and updates the appliance. The appliance is
   delivered as a release asset (a rootfs tarball): the install unpacks it, and the engine boots
   the machine from that directory — no registry, no credentials.
3. **Two folders, one crossing**:
   - `~/acornfall` — the share root, the one folder the machine mounts at its own path:
     `.agents/` (global skills, agents, prompts, commands), `config/` (`config.json`,
     `credentials.json`, `token`), `state/` (conversations, the workspace registry), and
     `workspaces/<name>/`.
   - `~/.acornfall` — host only, the launcher's: the engine's install and its store (images, the
     machine's disk). No secrets.
4. **The provider key and the product state live in the mount.** The worker reads the key there;
   the state is a file in the user's own folder, so it survives every image and machine rebuild,
   and it is the thing a person backs up.
5. **Nothing under the mount is bound into a container unless the policy names it**, and the
   policy mapping refuses any bind that would cover `config/`, `state/`, or the root itself —
   in both directions: a path outside the root, and a path above the private ones.
6. **The worker's exec becomes local**: `lxc-attach` inside the machine, in a process group it
   can kill. The SDK, the command-line-versus-SDK split, and the shim's wire go with it.

## What it buys

- **One Linux target.** Everything above the machine is Linux on all three hosts, and the host's
  job is the same everywhere: boot it, publish a port.
- **The awkward parts disappear.** No native SDK per host platform, no bun install on the host,
  no shim protocol, no shared-store coupling between two pins.
- **Exec and file operations are local** to the containers: cheaper, and the abort/kill semantics
  the SDK existed for come from owning the process instead of asking a hypervisor to.
- **One thing to back up**, and it is the user's folder. The machine becomes disposable: its
  state and its key are outside it.
- **A machine without a hypervisor is still a supported shape**: the same appliance runs on the
  host, explicitly chosen ([ADR 0015](0015-host-engine.md)), not drifted into.

## The price

- **The key is inside the folder the machine mounts.** No container sees it unless a policy names
  it — but a *privileged* workspace can read it (its root is the machine's root), and so can any
  bind that reaches it. Decision 5 is what stands between the two, and it is policy, not a mount
  boundary. ADR 0012's property — "the provider credential exists only on the host side" — is
  given up knowingly.
- **One machine is always up.** The appliance's memory is resident whether or not a workspace is
  working (the machine never stops for being idle — ADR 0021).
- **The console's transport is a hop**: browser → host → machine. The host publishes a port, and
  [ADR 0020](0020-the-tailnet-is-the-only-transport.md)'s "the tailnet is the only transport"
  needs a look at where that port binds.
- **The user's non-workspace files are no longer reachable by the model.** The worker's routing
  today is "under the workspace → sandbox, elsewhere → host"; inside the machine, "elsewhere" is
  nothing of the user's.
- **Two things to update** (the appliance and the launcher), and a bad appliance image is a
  machine that does not come up.

## Alternatives

- **Keep the gateway and the worker on the host** — today's shape (ADR 0012). The credential
  stays host-only, the host's files stay reachable, and nothing new has to be built; the cost is
  everything under "what it buys".
- **Only the worker in the machine, the gateway on the host.** Half the move: the key stays on
  the host and the host's files stay reachable, and a control wire for the worker has to be built
  and kept.
- **The appliance on the host, no machine at all.** The same appliance code run natively — the
  shape ADR 0015's host engine points at. Kept as an explicit mode, never as a fallback.

## Consequences

- ADR 0012's "the worker stays on the host" is superseded; its measurement (the command line
  versus the SDK) is why the exec is local now.
- ADR 0015's host engine becomes "the appliance on the host" rather than "the tools on the host".
- ADR 0019 (self-update) grows a second piece: the launcher updates the appliance image and the
  launcher, and the appliance updates itself inside the machine — who owns which is open.
- ADR 0021's machine stops being only where containers live: it is the product's home.
- ADR 0020 (the tailnet) needs the port question answered where the console lands.
- The install layout changes (`~/acornfall` and `~/.acornfall`), and existing installs — including
  the one this repository is developed in — need a migration.
- Open: who runs the launcher's own update; whether a workspace may be privileged once the key
  lives in the mount (the flag exists, its cost is now the key); what the appliance image is
  called and how it is versioned against the launcher.
