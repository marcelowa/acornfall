# ADR 0021 — One microVM per machine, workspaces as LXC containers

Status: draft, not accepted — the owner's sketch, written down on 2026-10-17 so it stops
being lost. Nothing here is decided; the parts that exist in code are the seam it describes
(`gateway/internal/sandbox/layers.go`: the machine layer and the policy-to-container mapping),
the machine itself (`machine.go`: one VM per install, created once, sized by config, with a
live test), and the container's own configuration (`lxc.go`: the two profiles, as the spike
measured them). Nothing calls them from the product yet: the container lifecycle waits for
the transport, and who speaks to LXC is still open. The spike it asked for as its first step
has run on Linux/KVM: [docs/engineering/lxc-spike.md](../engineering/lxc-spike.md), and what
it measured is in "What the spike measured" below. The decision is still open.
Date: 2026-10-17

## Context

Today one microVM per workspace ([ADR 0012](0012-sandbox.md)): microsandbox as the engine, one
kernel per workspace, one boot per workspace, one memory footprint per workspace. The worker
stays on the host, and the sandbox is the only door to the workspace.

The sketch splits the two jobs the current shape gives to one machine:

| Job | Today | Sketch |
|---|---|---|
| cross-platform boundary | one microVM per workspace | one microVM per machine |
| per-workspace isolation | that microVM | an LXC container inside it |
| per-workspace resources | `cpus`, `memory` on the microVM | cgroup limits on the container |
| host files | each workspace mounted at its own path | one folder mounted in the VM; containers bind from it |

The owner's words:

> in order to support multiple platforms: linux/macos/windows the system will use a microvm
> this will also allow us to limit resources/assets and in order to create isolation and focus
> per workspace we'll use lxc inside, lxc default will be able to use host resources (which is
> the microvm). The microvm will mount a folder from the host and each workspace will mount
> what it needs from the host.

What already stands behind the sketch:

- microsandbox claims all three hosts — Linux (KVM), macOS (Apple Silicon), Windows (WHP) — in
  its README, from v0.7.6 through main. Only Linux/KVM is verified in this repo.
- Containers inside the guest are a supported shape: microsandbox documents running Docker
  inside a sandbox (`--root-disk flat:10G`, `docker:dind`), including containers inside that
  Docker. A flat root disk gives the inner layer a direct ext4 instead of nesting on the
  guest's OverlayFS.
- The inner layer needs no CPU virtualization flag — namespaces and cgroups only — so the
  isolation does not depend on nesting. A container that wants `/dev/kvm` for its own projects
  can be given the device by group, with no capabilities: measured on the CI runner's Proxmox
  LXC (`CapEff 0`, KVM API version 12).
- LXC already stands as an engine candidate in the secrets work (#95): rung 2 per-command env
  yes, rung 3 via a mounted broker socket, no built-in credential substitution.

## Decision (proposed)

1. **One microVM per machine**, created on first use and booted once. The disk is sized at
   install, cpu and memory by config. It is acornfall's machine, not a workspace's.
2. **A workspace is an LXC container in it.** Create, start, stop, and remove keep the meaning
   they have today for a sandbox, and the workspace's OCI image becomes the container's rootfs.
3. **The policy file keeps its fields** (`image`, `cpus`, `memory`, `network`, `idle_timeout`,
   `mounts`). `cpus` and `memory` become cgroup limits on the container — LXC's own default is
   no limit, the VM's whole share, and acornfall keeps writing explicit ones. `idle_timeout`
   stops a container, not the VM.
4. **The VM mounts one host folder** — a share root the install names — and nothing else. Each
   container binds only the paths its policy names: the workspace at its own path read-write,
   the global resource folders read-only ([ADR 0014](0014-global-resources-in-the-sandbox.md)).
   Declared binds stay the only doors.
5. **The worker stays on the host.** [ADR 0012](0012-sandbox.md)'s rule does not change: the
   container is the only door to the workspace, and the worker holds no host path to it.
6. **The engine seam holds.** In `gateway/internal/sandbox` the driver gains two layers —
   ensure the VM, then manage containers in it — and its calls keep their names (install,
   usable, list, create, start, stop, remove, environment).
7. **`/dev/kvm` reaches a container by group**, where the host can nest, and by nothing else.
   The 0.7.6 pin and [ADR 0018](0018-disable-vm-nesting.md) wait on upstream exactly as they
   do today. (The spike measured what "by group" costs in practice: the guest's node is
   `0600 root:root`, so the appliance must make it group- or world-readable first.)

## What it buys

- **A workspace costs a container, not a VM**: start and stop in a container's time, and the
  idle stop frees memory without a VM boot to come back.
- **One kernel and one base image per machine** to update, instead of one VM image per
  workspace; N workspaces no longer mean N resident kernels.
- **The platform seam is one piece**: the VM differs per OS, everything above it is Linux on
  all three hosts.
- **Limits and assets belong to the container**: cpu, memory, and with a per-container rootfs,
  the disk each workspace may grow into.

## The price (the parts to accept or refuse)

- **Isolation drops from one kernel per workspace to one kernel per machine.** An escape from a
  container reaches the VM's view: the share root, and through it every workspace, plus the
  other containers. Today an escape reaches one workspace and stops there. Mitigations:
  unprivileged containers (user namespaces), declared binds only, seccomp, and a share root as
  small as the product can make it.
- **Unprivileged drops powers that today's VM root has**: `mount`, `iptables`, device nodes,
  and the like. A workspace that needs them needs a privileged container — one flag that
  weakens the boundary. Today those powers are free inside the guest. This is the sharpest
  trade in the sketch.
- **One VM is one failure domain**: a wedged or broken VM stops every workspace at once.
- **LXC inside the microsandbox guest is unproven here**: the guest must run cgroup v2 and the
  namespace set, and the base image must carry the tooling. A spike is the first step — start
  `lxc-start` inside a sandbox, then run a workspace image as a container. **Measured on
  Linux/KVM 2026-10-18**: it runs. `docs/engineering/lxc-spike.md` has the numbers; the sharp
  parts it moved are in "What the spike measured" below.
- **Windows is unverified**: the README claims WHP; nothing in this repo has run microsandbox
  on Windows.

## What the spike measured

Run 2026-10-18 inside an acornfall workspace's own sandbox on Linux/KVM (microsandbox 0.7.6,
guest kernel 6.12.109, 2 cpus, 2027 MiB), with `scripts/spike-lxc.sh`; the full report is
[docs/engineering/lxc-spike.md](../engineering/lxc-spike.md). Linux/KVM only: nothing here says
anything about macOS or Windows.

| Fact | Privileged container | Unprivileged container |
|---|---|---|
| start / stop (kill) | 20 ms / 4 ms | 25 ms / 4 ms |
| policy `cpus`, `memory` as cgroup limits | applied | applied |
| workspace image as the rootfs | `lxc-create -t oci` from the registry | same |
| share root bound at its own path, read | yes | yes |
| share root written | yes | yes, files owned by the container's uid |
| a read-only bind written | refused | refused |
| `/proc`, `/sys`, `/sys/fs/cgroup` | all three | `/proc` only: the kernel refuses a sysfs mount in a user namespace |
| `/dev/kvm`, `KVM_CREATE_VM` | api version 12 | api version 12, no capabilities |

What the table changes:

- **The unprivileged profile pays more than the sketch said.** No sysfs means no `/sys` and no
  `/sys/fs/cgroup` inside a workspace, and the container cannot read its own limits. LXC's own
  default config fails to start at all there (`sys:mixed` is EPERM); the appliance writes its
  own config.
- **"By group" needs a mode first.** A fresh guest's `/dev/kvm` is `0600 root:root`; the
  appliance makes it group- or world-readable, adds the device rule and the bind, and then both
  profiles create a KVM VM with no capabilities.
- **A stop has to be a kill.** A graceful stop of an image with no init waits LXC's 60-second
  timeout; `-k` is 4 ms.
- **Read-only is the mount flag, not the mode.** With an idmap that carries the host user's uid,
  a container wrote the share root as root even though the folder was mode 755 and owned by the
  user; the same write on a read-only bind was refused. Treating a mode as a boundary would be
  wrong.
- **File ownership needs one more check.** A container's write landed owned by the container's
  uid (100000) in the guest's view; who the *host* then says owns it, and whether the user can
  edit it, is the first follow-up. The workspace is supposed to belong to the person.

And four facts the container's own configuration turned out to have, found when the same
configuration was written in Go (`gateway/internal/sandbox/lxc.go`) and run again the same way:

- **A mount target is relative to the container's rootfs.** An absolute one is taken as a path
  outside the container and skipped — silently, because the entry is optional — so a workspace
  would come up with no door at all and no error.
- **The parent folders have to exist in the image.** `create=dir` makes the leaf only, and
  `create=auto` makes nothing at all; a bind whose parent is missing is another silent skip.
  Whoever creates a container makes those paths first.
- **A file is not a folder.** The install's `config.json` is a file among the mounts, and the
  runtime has to be told which kind of target to make.
- **`/dev/kvm` needs three things together**: the device readable in the guest, the device rule
  in the container's cgroup, and the bind. Two of the three is a container that starts without
  KVM.

## Alternatives

- **Keep one microVM per workspace** — today's shape. The strongest isolation, the highest cost
  per workspace. The sketch is not a rejection of it, only a cheaper reading of the same idea.
- **A second microVM engine** (issue #31, smolvm) — changes the engine, not the cost per
  workspace.
- **systemd-nspawn, bubblewrap, or Docker inside the guest instead of LXC** — the same shape
  with another tool. LXC is the owner's choice; the tool stays open until a spike says
  otherwise.
- **Privileged containers everywhere** — makes tools work, gives up the boundary.

## Consequences

- `gateway/internal/sandbox`: `Microsandbox` grows the VM/container split; `Manager` keeps
  owning policy and refusal.
- `worker/src/sandbox.ts`: `SandboxClient` keeps its surface (exec and files); what sits behind
  it is a container inside one VM.
- State layout changes: one VM record, a container record per workspace. No migration plan for
  existing installs yet.
- Networking moves to the container (none or veth), so the egress rules and the guest at
  `172.16.0.10` ([ADR 0020](0020-the-tailnet-is-the-only-transport.md), last hop) need a
  second look.
- Open: what the share root is (the workspaces folder? the home?) and who chooses it; the VM's
  idle policy (stay up, or stop when the last container stops); who speaks to LXC — the gateway
  over the engine's exec, or a small shim in the guest.
