package sandbox

import (
	"crypto/sha256"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"syscall"

	"github.com/acornfall/acornfall/gateway/internal/shim"
)

// The container layer of ADR 0021: one workspace as an LXC container inside the machine.
//
// This file is the container's own configuration — the part that is the same however the
// gateway reaches LXC, over the engine's exec or through a shim in the guest, which is why it
// is here rather than behind that still-open choice. Every value in it is one the spike
// measured: scripts/spike-lxc.sh writes the same configuration and runs it for real, and
// docs/engineering/lxc-spike.md has the report.

// lxcIDShift is where an unprivileged container's mapped user range starts in the guest: LXC's
// own convention, and what the guest's /etc/subuid and /etc/subgid have to allow. Measured: a
// range that is not there is a container that does not start.
const lxcIDShift = 100000

// A workspace's container runs a command that stays alive, and nothing else. The container has
// no init of its own — the worker execs into it — but the runtime waits for one, and an image
// with no init fails to start (measured). `sleep` is in every base image the product talks
// about; an image without it needs the workspace's own answer.
const lxcContainerInit = "/bin/sleep infinity"

// The containers' own network, inside the machine: one bridge, one private subnet, and the
// bridge as the way out. ADR 0021's consequences put the network on the container, and this is
// what that means in practice — a container that wants egress gets a veth on this bridge, and
// one that does not gets no interface at all.
const (
	// ContainerBridge is the bridge every container with a network joins, and ContainerSubnet is
	// the network on it: private, small, and inside one machine.
	ContainerBridge = "acornfall0"
	ContainerSubnet = "10.7.0.0/24"
	// ContainerGateway is the bridge's own address: the containers' way out of the machine.
	ContainerGateway = "10.7.0.1"
)

// ContainerNetwork is a container's place on the machine's bridge. Nil is a container with no
// network at all — `lxc.net.0.type = none` — which is what a workspace that forbids egress gets.
type ContainerNetwork struct {
	Bridge string
	// Address is the container's own address with its prefix: 10.7.0.7/24.
	Address string
	Gateway string
}

// LXCSettings is what a container needs that a workspace's policy does not carry. Every one of
// these is the appliance's choice rather than the workspace's, which is why they are here and
// not in Policy.
type LXCSettings struct {
	// Dir is the container's own folder inside the machine: the runtime's layout, its config
	// beside the image blobs, and the rootfs at <Dir>/rootfs.
	Dir string
	// Unprivileged runs the container in a user namespace, which is ADR 0021's mitigation and
	// costs what the spike measured: no /sys and no /sys/fs/cgroup inside, and the runtime's
	// own template config refuses to start. The ADR lists the choice as open, so there is no
	// default here: the caller says which profile a workspace runs in.
	Unprivileged bool
	// UID and GID are the share root's owner as the machine sees it — the host user, presented
	// in the guest by the engine's mount. They become the identity entry of an unprivileged
	// container's id map, without which its root writes files the user cannot manage
	// (measured: with no entry, the container's root may not write the share at all).
	UID, GID int
	// KVM binds /dev/kvm and allows the device, so a workspace can run its own virtual
	// machines. It needs the machine to have been created with nesting, and the device to be
	// readable in the guest: a fresh guest has it 0600 root:root (measured).
	KVM bool
	// Network is the container's place on the machine's bridge, or nil for no network. A
	// container whose policy wants egress needs one: the engine has to give it, because the
	// bridge is the machine's to make.
	Network *ContainerNetwork
	// MemoryBytes and MemoryHigh are the container's ceiling and its soft limit: the ceiling is
	// the workspace's own and never more than half the machine, and high is where reclaim starts
	// (three quarters of it) so a workspace is squeezed before it is killed.
	MemoryBytes int64
	MemoryHigh  int64
	// CPUWeight is the container's share of a contended cpu: proportional, never reserved.
	CPUWeight int
	// Init is what the container runs as its init. Empty takes lxcContainerInit.
	Init string
}

// LXCConfig is the container's configuration as the runtime reads it. The two profiles differ
// in exactly what the spike measured them to differ in: the privileged one mounts sysfs and
// needs no map, the unprivileged one cannot mount sysfs at all and needs the map.
func (c Container) LXCConfig(s LXCSettings) ([]byte, error) {
	// A container that wants egress needs the machine's bridge, and a container without one would
	// have no network at all: a quieter lie than the refusal. The engine gives it one (ContainerFor).
	if c.Egress && s.Network == nil {
		return nil, errors.New("sandbox: this workspace wants a network and the engine gave its container no bridge: there is nothing to attach it to")
	}
	if strings.TrimSpace(s.Dir) == "" {
		return nil, errors.New("sandbox: a container needs a folder for its rootfs")
	}
	if strings.TrimSpace(c.Name) == "" {
		return nil, errors.New("sandbox: a container needs a name")
	}
	// The limits are always written, because the runtime's default is no limit at all: a
	// container without them would take the whole machine, so a caller that asks for one is told.
	if c.CPUs <= 0 {
		return nil, errors.New("sandbox: a container needs a cpu limit: the runtime's default is no limit")
	}
	if c.MemoryBytes <= 0 {
		return nil, errors.New("sandbox: a container needs a memory limit: the runtime's default is no limit")
	}
	for _, bind := range c.Binds {
		if hasSpace(bind.Source) || hasSpace(bind.Target) {
			return nil, fmt.Errorf("sandbox: %s cannot be a container mount: the runtime's mount entries are whitespace-separated, so a path with a space in it would silently become another mount", bind.Source)
		}
		if strings.TrimPrefix(bind.Target, "/") == "" {
			return nil, fmt.Errorf("sandbox: %s cannot be a container mount: the target is the container's rootfs itself", bind.Source)
		}
	}
	init := s.Init
	if strings.TrimSpace(init) == "" {
		init = lxcContainerInit
	}

	var b strings.Builder
	fmt.Fprintf(&b, "lxc.uts.name = %s\n", c.Name)
	fmt.Fprintf(&b, "lxc.rootfs.path = dir:%s\n", filepath.Join(s.Dir, "rootfs"))
	// The runtime's own words about this container, kept beside it: a start that fails is
	// otherwise a state and a shrug, and the person who has to fix it has no log to read.
	fmt.Fprintf(&b, "lxc.log.file = %s\n", filepath.Join(s.Dir, "lxc.log"))
	b.WriteString("lxc.log.level = ERROR\n")
	// The container's own /dev, populated by lxc. Without it the rootfs's /dev is whatever the
	// image carried — nothing — and lxc-attach cannot even open /dev/null to start: "open_devnull:
	// Operation not permitted", which names neither /dev nor the config line missing (measured).
	b.WriteString("lxc.autodev = 1\n")
	// autodev makes the nodes; the device cgroup decides whether opening them is allowed. lxc's
	// own attach opens /dev/null before it enters the namespaces and gets EPERM when the allow
	// list is empty — the error is "Operation not permitted", not "no such file", and the command
	// runs anyway (measured). These are the nodes a container's init and lxc itself need.
	for _, device := range []string{"c 1:3 rwm", "c 1:5 rwm", "c 1:7 rwm", "c 1:8 rwm", "c 1:9 rwm", "c 5:0 rwm", "c 5:1 rwm", "c 5:2 rwm", "c 136:* rwm"} {
		fmt.Fprintf(&b, "lxc.cgroup2.devices.allow = %s\n", device)
	}
	// The network: a veth on the machine's bridge when the workspace's policy wants one, and no
	// interface at all when it does not. Saying nothing would hand it the machine's own network.
	if c.Egress {
		b.WriteString("lxc.net.0.type = veth\n")
		fmt.Fprintf(&b, "lxc.net.0.link = %s\n", s.Network.Bridge)
		b.WriteString("lxc.net.0.flags = up\n")
		fmt.Fprintf(&b, "lxc.net.0.ipv4.address = %s\n", s.Network.Address)
		fmt.Fprintf(&b, "lxc.net.0.ipv4.gateway = %s\n", s.Network.Gateway)
	} else {
		b.WriteString("lxc.net.0.type = none\n")
	}
	if s.Unprivileged {
		// proc:rw and nothing else: a sysfs mount is refused inside a user namespace, and
		// sys:mixed is what the runtime's own template asks for and fails on (measured).
		b.WriteString("lxc.mount.auto = proc:rw\n")
	} else {
		b.WriteString("lxc.mount.auto = proc:mixed sys:mixed\n")
	}
	fmt.Fprintf(&b, "lxc.init.cmd = %s\n", init)
	// The limits the policy names, always explicit: the runtime's default is no limit at all,
	// which would hand one workspace the whole machine.
	fmt.Fprintf(&b, "lxc.cgroup2.cpu.max = %d 100000\n", c.CPUs*100000)
	// The effective ceiling: the workspace's ask, capped by the machine when the engine knows it
	// (LXCSettings.MemoryBytes is that answer, and it is zero when nobody could say).
	ceiling := c.MemoryBytes
	if s.MemoryBytes > 0 {
		ceiling = s.MemoryBytes
	}
	fmt.Fprintf(&b, "lxc.cgroup2.memory.max = %d\n", ceiling)
	// The soft limit first in effect: reclaim and throttling begin there, so a workspace that
	// outgrows its expectation is squeezed while it can still finish, and the hard limit is what
	// stops it taking the machine down.
	if s.MemoryHigh > 0 && s.MemoryHigh < ceiling {
		fmt.Fprintf(&b, "lxc.cgroup2.memory.high = %d\n", s.MemoryHigh)
	}
	// A share, not a reservation: cgroup v2's default is 100, and a workspace that asked for more
	// cpus is proportionally louder when cpus are contended and gives its share away when idle.
	if s.CPUWeight > 0 {
		fmt.Fprintf(&b, "lxc.cgroup2.cpu.weight = %d\n", s.CPUWeight)
	}
	if s.KVM {
		b.WriteString("lxc.cgroup2.devices.allow = c 10:232 rwm\n")
	}
	// The binds: every host path the container may see, and the only ones. Read-only is the
	// mount flag, which is what holds (measured); a mode would not.
	//
	// The target is relative to the container's rootfs: the runtime takes an absolute one as a
	// path it has no business touching and skips the entry — silently, when it is optional. The
	// container still sees it at its own path, because that is what the relative path means once
	// the rootfs is mounted. What the entry does not do is make the parent folders: a target
	// whose parent is not in the image yet is another silent skip, so whoever creates the
	// container has to make them (measured).
	for _, bind := range c.Binds {
		kind := "dir"
		if bind.File {
			kind = "file"
		}
		options := "bind,create=" + kind + ",optional"
		if bind.ReadOnly {
			options += ",ro"
		}
		fmt.Fprintf(&b, "lxc.mount.entry = %s %s none %s\n", bind.Source, strings.TrimPrefix(bind.Target, "/"), options)
	}
	if s.KVM {
		b.WriteString("lxc.mount.entry = /dev/kvm dev/kvm none bind,optional,create=file\n")
	}
	if s.Unprivileged {
		b.WriteString(idMap("u", s.UID))
		b.WriteString(idMap("g", s.GID))
	}
	return []byte(b.String()), nil
}

// idMap is the user namespace's map: everything shifted, except the share root's owner, which
// stays where it is so an unprivileged container can write what the user owns. A uid the guest
// cannot have — nobody's, or root's — takes the plain shift, which is the safe direction: the
// container then simply cannot write the share.
func idMap(kind string, id int) string {
	if id <= 0 || id >= 65535 {
		return fmt.Sprintf("lxc.idmap = %s 0 %d 65536\n", kind, lxcIDShift)
	}
	var b strings.Builder
	fmt.Fprintf(&b, "lxc.idmap = %s 0 %d %d\n", kind, lxcIDShift, id)
	fmt.Fprintf(&b, "lxc.idmap = %s %d %d 1\n", kind, id, id)
	fmt.Fprintf(&b, "lxc.idmap = %s %d %d %d\n", kind, id+1, lxcIDShift+id+1, 65535-id)
	return b.String()
}

func hasSpace(value string) bool {
	return strings.ContainsAny(value, " \t\n")
}

// RootfsOwner is who owns a container's rootfs: the uid its own root maps to. An unprivileged
// container's root is lxcIDShift in the machine; a privileged one's is the machine's root. The
// difference is not a detail — a container whose filesystem belongs to somebody else starts and
// then cannot write it, which an image's package manager finds first.
func (s LXCSettings) RootfsOwner() int {
	if s.Unprivileged {
		return lxcIDShift
	}
	return 0
}

// RootfsGroup is RootfsOwner's group, which is the same number: the map shifts both.
func (s LXCSettings) RootfsGroup() int { return s.RootfsOwner() }

// ContainerFor maps a workspace's policy onto a container and the settings its engine runs it
// with. It is one function because the answer has to be the same whether the gateway is inside
// the machine (InMachine) or reaching the machine through the shim (LXC): a workspace whose
// container differs by which of the two is running would be a policy nobody can read.
// machineMemory is what the machine can give the containers in bytes, or zero when the caller does
// not know: the ceiling is then the workspace's own, which is what an engine tested in isolation
// can say.
func ContainerFor(policy Policy, shareRoot, dir string, privileged, nest bool, machineMemory int64) (Container, LXCSettings, error) {
	return containerForOwner(policy, shareRoot, dir, privileged, nest, machineMemory, currentOwner())
}

// shareOwner is who owns the folder the machine mounts. It is the mapping the container needs:
// a non-root owner is kept as itself in the user namespace so its tools can write the workspace,
// and a root-owned share is the one case the unprivileged map cannot express. The process owner
// is the fallback when the share does not exist yet.
func shareOwner(share string) owner {
	if uid, gid, ok := ShareOwner(share); ok {
		return owner{uid: uid, gid: gid, mapFiles: true}
	}
	return currentOwner()
}

// ShareOwner is who owns the folder the machine mounts, for the callers that create files in it.
// The gateway inside the machine runs as root, so a workspace it makes is root-owned unless it
// asks: the person's tools then run as the share owner and cannot write their own folder.
func ShareOwner(share string) (uid, gid int, ok bool) {
	info, err := os.Stat(share)
	if err != nil {
		return 0, 0, false
	}
	stat, ok := info.Sys().(*syscall.Stat_t)
	if !ok {
		return 0, 0, false
	}
	return int(stat.Uid), int(stat.Gid), true
}

// containerForOwner is ContainerFor with the share's owner supplied, so the root case is a test
// and not a property of the machine that happens to run it.
func containerForOwner(policy Policy, shareRoot, dir string, privileged, nest bool, machineMemory int64, owner owner) (Container, LXCSettings, error) {
	container, err := policy.Container(shareRoot)
	if err != nil {
		return Container{}, LXCSettings{}, err
	}
	ceiling := containerCeiling(container.MemoryBytes, machineMemory)
	settings := LXCSettings{
		Dir:         filepath.Join(dir, container.Name),
		UID:         owner.uid,
		GID:         owner.gid,
		MemoryBytes: ceiling,
		MemoryHigh:  softLimit(ceiling),
		CPUWeight:   cpuWeight(container.CPUs),
	}
	// A workspace can ask for the sharpest profile (ADR 0021's open question), and the engine
	// can hold it for everyone; either is enough. The unprivileged profile is the default
	// because a user namespace is the mitigation, and it is a separate decision from who owns
	// the share: the machine presents the share at a fixed non-root uid, so no host user has to
	// be mapped or privileged for the workspace to be writable.
	settings.Unprivileged = !(privileged || policy.Privileged)
	// The containers are where a workspace's own virtual machines would run, so the device goes
	// in when the workspace allows nesting and the machine can grant it.
	if !policy.DisableVMNesting && nest {
		settings.KVM = true
	}
	if container.Egress {
		settings.Network = NetworkFor(container.Name)
	}
	return container, settings, nil
}

// NetworkFor is a container's place on the bridge: an address derived from its name, so a
// container that is made again is reachable at the same address and nothing has to remember it.
func NetworkFor(name string) *ContainerNetwork {
	sum := sha256.Sum256([]byte(name))
	// .2 to .254: the first address is the bridge's own and the last is broadcast.
	host := int(sum[0])%253 + 2
	return &ContainerNetwork{
		Bridge:  ContainerBridge,
		Address: fmt.Sprintf("10.7.0.%d/24", host),
		Gateway: ContainerGateway,
	}
}

// networkPayload is the container's network as the runtime's side reads it (internal/shim).
func networkPayload(network *ContainerNetwork) *shim.NetworkPayload {
	if network == nil {
		return nil
	}
	return &shim.NetworkPayload{Bridge: network.Bridge, Subnet: ContainerSubnet, Gateway: network.Gateway}
}

// MachineMemory is what this machine can give the containers, in bytes: what a container's
// ceiling is measured against. The host-side engine reads it from the machine's configuration,
// the engine inside the machine from the machine itself (MachineMemoryBytes), and both are the
// same number said two ways.
func (m Machine) MemoryBytes() int64 {
	bytes, err := parseMemory(m.Memory)
	if err != nil || bytes <= 0 {
		return 0
	}
	return bytes
}

// containerCeiling is what one container may take: the workspace's own limit, and never more than
// half the machine. Half rather than all of it because two workspaces are the ordinary case: a
// limit that could take the whole machine is one that makes the second workspace pay for the
// first, and a container that reaches it takes the machine down with it instead of being slowed.
func containerCeiling(wanted, machine int64) int64 {
	if machine > 0 && (wanted <= 0 || wanted > machine/2) {
		return machine / 2
	}
	return wanted
}

// softLimit is where a container starts feeling the squeeze: three quarters of its ceiling, so
// reclaim happens while there is still headroom rather than at the wall.
func softLimit(ceiling int64) int64 {
	if ceiling <= 0 {
		return 0
	}
	return ceiling / 4 * 3
}

// cpuWeight is a workspace's share of a contended cpu, in cgroup v2's units: the runtime's
// default is 100, and a workspace that asked for more cpus is proportionally louder. It is a
// share, not a reservation — an idle workspace gives its share away.
func cpuWeight(cpus int) int {
	if cpus <= 0 {
		return 0
	}
	weight := cpus * 100
	if weight > 10000 {
		return 10000
	}
	return weight
}
