# The LXC-in-the-sandbox spike

The first step of [ADR 0021](../adr/0021-workspaces-as-lxc-containers.md) and issue #96: can a
workspace run as an LXC container inside a microsandbox guest, and what does the guest actually
grant it? `scripts/spike-lxc.sh` is the whole thing: run it inside a guest, as root, and it
prints what it measured.

It was run on 2026-10-18, inside an acornfall workspace's own sandbox (Linux/KVM host,
microsandbox 0.7.6, guest kernel 6.12.109, 2 cpus, 2027 MiB, Debian trixie, LXC 6.0.4). The
results are below, and nothing else has been measured: **no macOS, no Windows, and no run on a
flat root disk.** Every number and every FAIL here is a command that ran.

## How to run it

Inside a guest (this is how the run above was made — the workspace's own sandbox, where the
script arrives through the share):

```sh
apt-get install -y lxc jq skopeo umoci gcc     # or SPIKE_INSTALL=1
SPIKE_WORKSPACE=$(pwd) sh scripts/spike-lxc.sh
```

On a KVM host or a Mac, first make a sandbox to run it in. The Docker-in-a-sandbox guide gives
the shape (`msb run`/`msb exec`; confirm the flags with `msb create --help` on your pin):

```sh
msb run --name acornfall-lxc-spike --replace --root-disk flat:10G \
  --script 'exec sh' --entrypoint sleep debian:stable-slim
msb exec acornfall-lxc-spike -- sh -c 'apt-get update && apt-get install -y lxc jq skopeo umoci gcc'
# copy scripts/spike-lxc.sh into the sandbox (through a mount, or paste it), then:
msb exec acornfall-lxc-spike -- sh /path/to/spike-lxc.sh
```

It cleans up after itself (containers destroyed, `/dev/kvm` mode restored). `SPIKE_KEEP=1`
leaves the containers for inspection. The report goes to `./lxc-spike-report.txt`; paste it
into issue #96.

## What it measured

| Fact | Privileged container | Unprivileged container (user namespace, no capabilities) |
|---|---|---|
| start | **20 ms** | **25 ms** |
| stop (`lxc-stop -k`) | **4 ms** | **4 ms** |
| `cpus`/`memory` from the policy | `cpu.max = 200000 100000`, `memory.max = 536870912` | same |
| workspace image as the rootfs | `lxc-create -t oci -u docker://debian:stable-slim` | same |
| the share root, bound at its own path | readable | readable |
| writing the share root | yes, as uid 0 | yes, as the mapped host user's uid; files land owned by the container's uid |
| a read-only bind stays read-only | yes (write refused) | yes (write refused) |
| `/proc` | yes | yes |
| `/sys` and `/sys/fs/cgroup` | yes | **no** — the kernel refuses a sysfs mount inside a user namespace (EPERM) |
| `/dev/kvm`, `KVM_CREATE_VM` | yes, api version 12 | yes, api version 12 |

The guest itself: cgroup v2 unified with `cpuset cpu io memory hugetlb pids`; every namespace
present; `subtree_control` empty until LXC (or the appliance) enables the controllers; the
workspace arrives as a virtiofs mount; `/dev/kvm` is `0600 root:root`; the guest root is the
layered overlay (not the flat root disk the ADR suggests for Docker).

## What this changes

- **"LXC inside the guest is unproven" is now proven on Linux/KVM.** Containers start in
  milliseconds, the policy's cpu/memory become the container's cgroup limits, binds from the
  share root work both ways, and a read-only bind is enforced by the mount flag.
- **The unprivileged container cannot mount sysfs.** The standard template config
  (`common.conf`'s `sys:mixed`) fails outright with EPERM; a config with `proc:rw` and no sysfs
  starts. The cost is visible inside the workspace: no `/sys`, no `/sys/fs/cgroup`, so a tool
  that reads either sees an empty folder and the container cannot read its own limits. The
  price of unprivileged isolation is paid here, not in the ADR's abstract "mount and iptables".
- **`/dev/kvm` reaches a container by mode, not by group.** In the guest the node is
  `0600 root:root`; the appliance has to make it group- or world-readable, and the container
  needs the device rule (`lxc.cgroup2.devices.allow = c 10:232 rwm`) plus the bind. With that,
  both profiles created a KVM VM with no capabilities. The ADR's "by group" assumes a `kvm`
  group that a fresh guest does not have.
- **Stopping is a kill.** A graceful `lxc-stop` on an image whose init ignores the signal waits
  LXC's full 60-second timeout; `-k` is 4 ms. "Stop in a container's time" means stop by
  killing, after whatever grace period acornfall chooses.
- **Files written through a container are owned by the container's uid**, not the host user's:
  in this run a container root's write landed as `100000:100000` in the guest's view. What the
  host then sees, and whether the user can edit those files, needs its own check — the
  workspace is supposed to belong to the person. It is the first thing to measure before the
  design leans on the share root.
- **The share's modes are not a boundary; the mount flag is.** With an idmap that carries the
  host user's uid, the container wrote the share as root even though the folder is mode 755 and
  owned by someone else (measured twice, both directions). The `ro` bind refused the same
  write. Whatever the mechanism (the guest kernel's permission check with a partial idmap is
  the suspect), acornfall must treat "read-only" as the flag and not as the mode.
- **What the appliance has to set up inside the VM**: the controllers on the guest's root
  cgroup, `/etc/subuid` and `/etc/subgid` ranges for the unprivileged profile, the rootfs
  owned by the mapped uid, and `o+x` on the container's own directory — each one was a failure
  before it was a step.

## What it does not answer

- macOS and Windows: only Linux/KVM has run microsandbox here, and only Linux/KVM ran this.
- The flat root disk (`--root-disk flat:10G`): the ADR's reason to prefer it (overlay on
  overlay for an inner container runtime) was not tested.
- The share root: workspaces folder or the home. The spike used an existing virtiofs mount.
- Whether a workspace may be a privileged container, who speaks to LXC (the gateway over the
  engine's exec, or a shim in the guest), and the VM's idle policy. Those stay the owner's
  calls, and the report above says what each one costs.

## The follow-ups the run left open

1. Who owns a file a container writes in the share root, as seen on the host.
2. Why the single-range idmap refuses the share write and the split map does not.
3. The same script on a Mac, and on a flat root disk: two facts, two runs.
4. Whether `iptables` and `mount` work inside the privileged container (the ADR's sharpest
   trade lists them; this run did not try them).
