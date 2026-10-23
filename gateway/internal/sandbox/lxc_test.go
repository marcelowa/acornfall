package sandbox

import (
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

// workspace is a container as the policy mapping builds one, with the mounts a real workspace
// has: its own folder read-write, the globals read-only, and the install's config file, which is
// a file rather than a folder.
func workspaceContainer() Container {
	return Container{
		Name:        "acornfall-app-1234abcd",
		Image:       "golang:1.24",
		CPUs:        2,
		MemoryBytes: 2 << 30,
		Binds: []Bind{
			{Source: "/home/me/work", Target: "/home/me/work"},
			{Source: "/home/me/.agents", Target: "/home/me/.agents", ReadOnly: true},
			{Source: "/home/me/.acornfall/config.json", Target: "/home/me/.acornfall/config.json", ReadOnly: true, File: true},
		},
	}
}

// The unprivileged profile, pinned line by line: every value in it is one the spike measured,
// and a value lost here is a workspace that runs with a limit nobody wrote.
func TestTheUnprivilegedContainerConfigPinsWhatTheSpikeMeasured(t *testing.T) {
	config, err := workspaceContainer().LXCConfig(LXCSettings{
		Dir:          "/var/lib/lxc/acornfall-app-1234abcd",
		Unprivileged: true,
		UID:          1000,
		GID:          1000,
		KVM:          true,
	})
	if err != nil {
		t.Fatal(err)
	}
	text := string(config)
	for _, want := range []string{
		"lxc.uts.name = acornfall-app-1234abcd\n",
		"lxc.rootfs.path = dir:/var/lib/lxc/acornfall-app-1234abcd/rootfs\n",
		"lxc.log.file = /var/lib/lxc/acornfall-app-1234abcd/lxc.log\n",
		"lxc.log.level = ERROR\n",
		"lxc.autodev = 1\n",
		"lxc.cgroup2.devices.allow = c 1:3 rwm\n",
		"lxc.cgroup2.devices.allow = c 1:5 rwm\n",
		"lxc.cgroup2.devices.allow = c 1:7 rwm\n",
		"lxc.cgroup2.devices.allow = c 1:8 rwm\n",
		"lxc.cgroup2.devices.allow = c 1:9 rwm\n",
		"lxc.cgroup2.devices.allow = c 5:0 rwm\n",
		"lxc.cgroup2.devices.allow = c 5:1 rwm\n",
		"lxc.cgroup2.devices.allow = c 5:2 rwm\n",
		"lxc.cgroup2.devices.allow = c 136:* rwm\n",
		"lxc.net.0.type = none\n",
		"lxc.mount.auto = proc:rw\n",
		"lxc.cgroup2.cpu.max = 200000 100000\n",
		"lxc.cgroup2.memory.max = 2147483648\n",
		"lxc.cgroup2.devices.allow = c 10:232 rwm\n",
		"lxc.mount.entry = /home/me/work home/me/work none bind,create=dir,optional\n",
		"lxc.mount.entry = /home/me/.agents home/me/.agents none bind,create=dir,optional,ro\n",
		"lxc.mount.entry = /home/me/.acornfall/config.json home/me/.acornfall/config.json none bind,create=file,optional,ro\n",
		"lxc.mount.entry = /dev/kvm dev/kvm none bind,optional,create=file\n",
		"lxc.idmap = u 0 100000 1000\n",
		"lxc.idmap = u 1000 1000 1\n",
		"lxc.idmap = u 1001 101001 64535\n",
		"lxc.idmap = g 0 100000 1000\n",
		"lxc.idmap = g 1000 1000 1\n",
		"lxc.idmap = g 1001 101001 64535\n",
	} {
		if !strings.Contains(text, want) {
			t.Errorf("the config should hold %q, got:\n%s", want, text)
		}
	}
	// No network and no sysfs: the two things the spike measured an unprivileged container
	// cannot have.
	if strings.Contains(text, "veth") || strings.Contains(text, "sys:mixed") {
		t.Errorf("neither a network nor sysfs belongs in this profile, got:\n%s", text)
	}
}

// The privileged profile is the other measured shape: sysfs mounts, and no user namespace to map.
func TestThePrivilegedContainerConfigKeepsItsSysfsAndNeedsNoMap(t *testing.T) {
	config, err := workspaceContainer().LXCConfig(LXCSettings{Dir: "/var/lib/lxc/ws"})
	if err != nil {
		t.Fatal(err)
	}
	text := string(config)
	if !strings.Contains(text, "lxc.mount.auto = proc:mixed sys:mixed\n") {
		t.Errorf("a privileged container can mount sysfs, got:\n%s", text)
	}
	if strings.Contains(text, "lxc.idmap") {
		t.Errorf("a privileged container needs no map, got:\n%s", text)
	}
	if strings.Contains(text, "/dev/kvm") {
		t.Errorf("without KVM asked for, no device belongs in it, got:\n%s", text)
	}
}

// A uid the guest cannot have — nobody's, root's — takes the plain shift, which is the safe
// direction: the container then cannot write the share the user owns.
func TestAContainerWithNoIdentityUidTakesThePlainShift(t *testing.T) {
	for _, id := range []int{0, -1, 65535} {
		config, err := workspaceContainer().LXCConfig(LXCSettings{Dir: "/var/lib/lxc/ws", Unprivileged: true, UID: id, GID: id})
		if err != nil {
			t.Fatal(err)
		}
		if !strings.Contains(string(config), "lxc.idmap = u 0 100000 65536\n") {
			t.Errorf("uid %d should take the plain shift, got:\n%s", id, config)
		}
		if strings.Contains(string(config), "lxc.idmap = u 1001") {
			t.Errorf("uid %d should not add an identity entry, got:\n%s", id, config)
		}
	}
}

// A workspace that wants a network gets a veth on the machine's bridge, with the address the
// engine derived for it; one that does not gets no interface at all. Both are pinned here,
// because both are the difference between a workspace's policy and a hope.
func TestAContainerGetsTheNetworkItsPolicyAsksFor(t *testing.T) {
	container := workspaceContainer()
	container.Egress = true
	network := NetworkFor(container.Name)
	config, err := container.LXCConfig(LXCSettings{Dir: "/var/lib/lxc/ws", Network: network})
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"lxc.net.0.type = veth\n",
		"lxc.net.0.link = acornfall0\n",
		"lxc.net.0.flags = up\n",
		"lxc.net.0.ipv4.address = " + network.Address + "\n",
		"lxc.net.0.ipv4.gateway = 10.7.0.1\n",
	} {
		if !strings.Contains(string(config), want) {
			t.Errorf("want %q in:\n%s", want, config)
		}
	}
	if strings.Contains(string(config), "lxc.net.0.type = none") {
		t.Errorf("a workspace that asks for a network should not get none:\n%s", config)
	}

	quiet, err := workspaceContainer().LXCConfig(LXCSettings{Dir: "/var/lib/lxc/ws"})
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(quiet), "lxc.net.0.type = none\n") {
		t.Errorf("a workspace that forbids egress gets no interface, got:\n%s", quiet)
	}
}

// A container that wants egress and has no bridge to join is refused: it would have no network
// at all, which is a quieter lie than the refusal.
func TestAContainerRefusesTheNetworkItCannotHave(t *testing.T) {
	container := workspaceContainer()
	container.Egress = true
	_, err := container.LXCConfig(LXCSettings{Dir: "/var/lib/lxc/ws"})
	if err == nil || !strings.Contains(err.Error(), "bridge") {
		t.Fatalf("want a refusal naming the bridge, got %v", err)
	}
}

// The address is derived from the container's name, so a container made again is reachable at
// the same address and nothing has to remember it.
func TestAContainerAddressFollowsItsName(t *testing.T) {
	first := NetworkFor("acornfall-app-1234abcd")
	again := NetworkFor("acornfall-app-1234abcd")
	other := NetworkFor("acornfall-app-deadbeef")
	if first.Address != again.Address {
		t.Errorf("the same container should get the same address: %s and %s", first.Address, again.Address)
	}
	if first.Address == other.Address {
		t.Errorf("two containers should not share an address: %s", first.Address)
	}
	if !strings.HasPrefix(first.Address, "10.7.0.") || !strings.HasSuffix(first.Address, "/24") {
		t.Errorf("address %s is not on the containers' network", first.Address)
	}
}

// A mount entry is whitespace-separated, so a path with a space in it would become two fields
// and a mount nobody asked for. Refused by name instead of written.
func TestAContainerRefusesAPathItCannotMountSafely(t *testing.T) {
	container := workspaceContainer()
	container.Binds = append(container.Binds, Bind{Source: "/home/me/two words", Target: "/home/me/two words"})
	_, err := container.LXCConfig(LXCSettings{Dir: "/var/lib/lxc/ws"})
	if err == nil || !strings.Contains(err.Error(), "two words") {
		t.Fatalf("want a refusal naming the path, got %v", err)
	}
}

// An absolute destination is taken as a path outside the container and skipped, and a target at
// the rootfs itself is not a mount either. Both are refused rather than written.
func TestAContainerRefusesAMountTargetTheRuntimeWouldSkip(t *testing.T) {
	container := workspaceContainer()
	container.Binds = []Bind{{Source: "/home/me/work", Target: "/"}}
	_, err := container.LXCConfig(LXCSettings{Dir: "/var/lib/lxc/ws"})
	if err == nil || !strings.Contains(err.Error(), "rootfs itself") {
		t.Fatalf("want a refusal naming the target, got %v", err)
	}
}

// The limits are always explicit because the runtime's default is no limit at all: a container
// built by hand without them would take the whole machine, so it is refused.
func TestAContainerNeedsExplicitLimitsAndPlaces(t *testing.T) {
	if _, err := (Container{Name: "ws", CPUs: 2, MemoryBytes: 1 << 30}).LXCConfig(LXCSettings{}); err == nil {
		t.Error("a container needs a folder for its rootfs")
	}
	if _, err := (Container{CPUs: 2, MemoryBytes: 1 << 30}).LXCConfig(LXCSettings{Dir: "/var/lib/lxc/ws"}); err == nil {
		t.Error("a container needs a name")
	}
	if _, err := (Container{Name: "ws", MemoryBytes: 1 << 30}).LXCConfig(LXCSettings{Dir: "/var/lib/lxc/ws"}); err == nil {
		t.Error("a container needs a cpu limit")
	}
	if _, err := (Container{Name: "ws", CPUs: 2}).LXCConfig(LXCSettings{Dir: "/var/lib/lxc/ws"}); err == nil {
		t.Error("a container needs a memory limit")
	}
}

// ADR 0021 leaves the profile open and proposes unprivileged; a workspace can ask for the other
// one, and the engine can hold it for everyone. Either way the setting has to reach the
// configuration: a profile that stopped at the policy would be a promise with no effect.
func TestAWorkspaceOrTheEngineCanAskForThePrivilegedProfile(t *testing.T) {
	root := t.TempDir()
	workspace := filepath.Join(root, "work")
	policy := Policy{Image: "debian:stable-slim", Workspace: workspace, Privileged: true}
	container, settings, err := ContainerFor(policy, root, "/var/lib/lxc", false, false, 0)
	if err != nil {
		t.Fatal(err)
	}
	if settings.Unprivileged {
		t.Error("a workspace that asks for the privileged profile should get it")
	}
	config, err := container.LXCConfig(settings)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(config), "lxc.idmap") {
		t.Errorf("the privileged profile maps no ids:\n%s", config)
	}

	engineWide, settings, err := ContainerFor(Policy{Image: "debian:stable-slim", Workspace: workspace}, root, "/var/lib/lxc", true, false, 0)
	if err != nil {
		t.Fatal(err)
	}
	if settings.Unprivileged {
		t.Error("an engine told to run privileged containers should run them")
	}
	_ = engineWide

	_, quiet, err := containerForOwner(Policy{Image: "debian:stable-slim", Workspace: workspace}, root, "/var/lib/lxc", false, false, 0, owner{uid: 1000, gid: 1000})
	if err != nil {
		t.Fatal(err)
	}
	if !quiet.Unprivileged {
		t.Error("the default is the mitigation: unprivileged unless somebody asked")
	}

	// The share's owner does not choose the profile. The machine presents the share at a fixed
	// non-root uid, so a root-owned host folder is normalized before the container sees it; the
	// privilege decision belongs to the workspace and the engine alone.
	_, rootOwned, err := containerForOwner(Policy{Image: "debian:stable-slim", Workspace: workspace}, root, "/var/lib/lxc", false, false, 0, owner{uid: 0, gid: 0})
	if err != nil {
		t.Fatal(err)
	}
	if !rootOwned.Unprivileged {
		t.Error("a root host share must not make the container privileged")
	}
}

// What a container is given is a ceiling and a share, never a reservation: the ceiling is the
// workspace's own and never more than half the machine, the soft limit is where reclaim starts,
// and the cpu is a weight that divides when contended and is given away when idle.
func TestAContainersResourcesAreCeilingsNotReservations(t *testing.T) {
	root := t.TempDir()
	workspace := filepath.Join(root, "work")
	const machine = 4 << 30
	container, settings, err := ContainerFor(
		Policy{Image: "debian:stable-slim", Workspace: workspace, CPUs: 2, Memory: "8G"}, root, "/var/lib/lxc", false, false, machine)
	if err != nil {
		t.Fatal(err)
	}
	if settings.MemoryBytes != machine/2 {
		t.Errorf("a workspace cannot be given more than half the machine: got %d, want %d", settings.MemoryBytes, machine/2)
	}
	if settings.MemoryHigh >= settings.MemoryBytes {
		t.Errorf("the soft limit has to come before the hard one: high %d, max %d", settings.MemoryHigh, settings.MemoryBytes)
	}
	if settings.CPUWeight != 200 {
		t.Errorf("two cpus is twice the runtime's share: got %d, want 200", settings.CPUWeight)
	}
	config, err := container.LXCConfig(settings)
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"lxc.cgroup2.memory.max = " + strconv.FormatInt(machine/2, 10),
		"lxc.cgroup2.memory.high = " + strconv.FormatInt(settings.MemoryHigh, 10),
		"lxc.cgroup2.cpu.weight = 200",
	} {
		if !strings.Contains(string(config), want) {
			t.Errorf("want %q in:\n%s", want, config)
		}
	}

	// A workspace that asks for less than half keeps what it asked for, and an engine that does
	// not know the machine's size (a test, or a run without one) does not invent a ceiling.
	_, small, err := ContainerFor(Policy{Image: "debian:stable-slim", Workspace: workspace, Memory: "1G"}, root, "/var/lib/lxc", false, false, machine)
	if err != nil {
		t.Fatal(err)
	}
	if small.MemoryBytes != 1<<30 {
		t.Errorf("a workspace under the cap keeps its own limit: got %d", small.MemoryBytes)
	}
	_, unknown, err := ContainerFor(Policy{Image: "debian:stable-slim", Workspace: workspace, Memory: "1G"}, root, "/var/lib/lxc", false, false, 0)
	if err != nil {
		t.Fatal(err)
	}
	if unknown.MemoryBytes != 1<<30 {
		t.Errorf("an engine that does not know the machine should not cap: got %d", unknown.MemoryBytes)
	}
}
