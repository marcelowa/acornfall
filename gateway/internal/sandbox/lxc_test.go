package sandbox

import (
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

// A container's network is the piece ADR 0021 says needs a second look, so it refuses rather than
// handing the workspace the VM's own network. The refusal names the decision, not the code.
func TestAContainerRefusesTheNetworkItCannotHaveYet(t *testing.T) {
	container := workspaceContainer()
	container.Egress = true
	_, err := container.LXCConfig(LXCSettings{Dir: "/var/lib/lxc/ws"})
	if err == nil || !strings.Contains(err.Error(), "0021") {
		t.Fatalf("want a refusal naming the decision, got %v", err)
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
