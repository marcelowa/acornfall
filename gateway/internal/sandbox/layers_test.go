package sandbox

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// The policy is the whole promise a workspace makes about its sandbox, and the container is
// what the machine's runtime is told. A number that is lost here is a workspace that runs with
// a limit nobody wrote, so the mapping is pinned field by field.
func TestAContainerGetsThePolicyLimits(t *testing.T) {
	policy := Policy{
		Image:       "golang:1.24",
		CPUs:        4,
		Memory:      "1G",
		Egress:      true,
		Workspace:   "/home/me/work/app",
		Global:      []string{"/home/me/.agents", "/home/me/.acornfall/skills"},
		IdleTimeout: "10m",
	}
	container, err := policy.Container("/home/me")
	if err != nil {
		t.Fatal(err)
	}
	if container.Name != Name("/home/me/work/app") {
		t.Errorf("name = %q, want the engine's name for the workspace", container.Name)
	}
	if container.Image != "golang:1.24" {
		t.Errorf("image = %q: the policy's image is the container's rootfs", container.Image)
	}
	if container.CPUs != 4 {
		t.Errorf("cpus = %d", container.CPUs)
	}
	if container.MemoryBytes != 1<<30 {
		t.Errorf("memory = %d bytes, want 1 GiB", container.MemoryBytes)
	}
	if !container.Egress {
		t.Error("egress should survive the mapping")
	}
	if container.IdleTimeout != 10*time.Minute {
		t.Errorf("idle timeout = %v", container.IdleTimeout)
	}
	want := []Bind{
		{Source: "/home/me/work/app", Target: "/home/me/work/app", ReadOnly: false},
		{Source: "/home/me/.agents", Target: "/home/me/.agents", ReadOnly: true},
		{Source: "/home/me/.acornfall/skills", Target: "/home/me/.acornfall/skills", ReadOnly: true},
	}
	if len(container.Binds) != len(want) {
		t.Fatalf("binds = %v, want %v", container.Binds, want)
	}
	for i, bind := range container.Binds {
		if bind != want[i] {
			t.Errorf("bind %d = %+v, want %+v", i, bind, want[i])
		}
	}
}

// LXC's own default is no limit — the whole machine — so a policy that leaves the numbers
// unset must still produce explicit ones. Anything else would let one workspace starve the
// machine the others share.
func TestAContainerGetsExplicitLimitsWhenThePolicyLeavesThemUnset(t *testing.T) {
	container, err := Policy{Workspace: "/home/me/work"}.Container("/home/me")
	if err != nil {
		t.Fatal(err)
	}
	if container.CPUs != DefaultCPUs {
		t.Errorf("cpus = %d, want the default %d", container.CPUs, DefaultCPUs)
	}
	if container.MemoryBytes != 2<<30 {
		t.Errorf("memory = %d bytes, want the default 2 GiB", container.MemoryBytes)
	}
	if container.IdleTimeout != 30*time.Minute {
		t.Errorf("idle timeout = %v, want the default 30m", container.IdleTimeout)
	}
	if container.Egress {
		t.Error("egress should stay off unless the policy allows it")
	}
}

// The share root is the only door: a policy path outside it is refused by name, not silently
// dropped and not bound anyway. A sibling that shares a prefix is outside too, which is the
// bug a string comparison would introduce.
func TestAContainerBindsOnlyWhatTheShareRootHolds(t *testing.T) {
	_, err := Policy{Workspace: "/home/me/work", Global: []string{"/home/me/.agents"}}.Container("/home/me/workspaces")
	if err == nil || !strings.Contains(err.Error(), "/home/me/work") || !strings.Contains(err.Error(), "/home/me/workspaces") {
		t.Fatalf("want a refusal naming the path and the root, got %v", err)
	}
	_, err = Policy{Workspace: "/home/me/workspaces2/app"}.Container("/home/me/workspaces")
	if err == nil || !strings.Contains(err.Error(), "/home/me/workspaces2/app") {
		t.Fatalf("a sibling of the share root is outside it, got %v", err)
	}
}

// Nobody has chosen the share root yet (ADR 0021 leaves it to the owner). An empty one is a
// refusal: guessing would decide, silently, what an escape from a container reaches.
func TestAContainerRefusesWithoutAShareRoot(t *testing.T) {
	_, err := Policy{Workspace: "/home/me/work"}.Container("")
	if err == nil || !strings.Contains(err.Error(), "share root") {
		t.Fatalf("want a refusal naming the share root, got %v", err)
	}
}

func TestMemoryCountsBytesAndRefusesWhatItCannot(t *testing.T) {
	for _, test := range []struct {
		value string
		want  int64
	}{
		{"512M", 512 << 20},
		{"2G", 2 << 30},
		{"2g", 2 << 30},
		{"2GiB", 2 << 30},
		{"1T", 1 << 40},
		{"1024K", 1 << 20},
		{"1048576", 1 << 20},
		{" 4G ", 4 << 30},
	} {
		got, err := parseMemory(test.value)
		if err != nil {
			t.Errorf("%q: %v", test.value, err)
			continue
		}
		if got != test.want {
			t.Errorf("%q = %d bytes, want %d", test.value, got, test.want)
		}
	}
	for _, value := range []string{"", "1.5G", "2X", "0", "-1G", "gigabytes", "99999999T"} {
		if got, err := parseMemory(value); err == nil {
			t.Errorf("%q should be refused, got %d bytes", value, got)
		}
	}
}

// The globals include a file — the install's config.json — and the runtime has to be told which
// kind of target to make: the wrong kind is a mount that silently does not happen, so the kind
// is read from the host where the path exists.
func TestABindKnowsAFileFromAFolder(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, "work"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "config.json"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	container, err := Policy{
		Workspace: filepath.Join(root, "work"),
		Global:    []string{filepath.Join(root, "config.json")},
	}.Container(root)
	if err != nil {
		t.Fatal(err)
	}
	if container.Binds[0].File {
		t.Error("a workspace is a folder")
	}
	if !container.Binds[1].File {
		t.Error("config.json is a file")
	}
}

// ADR 0022 puts the provider key and the product's state inside the folder the machine mounts, so
// what keeps them out of a container is this mapping and nothing else. Both directions are
// tested, because both are a door: a path outside the root, and a path above the private ones.
func TestAContainerNeverSeesTheRootsPrivateFiles(t *testing.T) {
	root := t.TempDir()
	for _, folder := range []string{"workspaces/work", ".agents/skills", "config", "state"} {
		if err := os.MkdirAll(filepath.Join(root, folder), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	for _, file := range []string{"config/config.json", "config/credentials.json", "state/conversations.json"} {
		if err := os.WriteFile(filepath.Join(root, file), []byte("{}"), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	allowed := []string{
		filepath.Join(root, "workspaces/work"),
		filepath.Join(root, ".agents"),
		filepath.Join(root, "config", "config.json"),
	}
	for _, path := range allowed {
		if _, err := (Policy{Workspace: path}).Container(root); err != nil {
			t.Errorf("%s should be bindable: %v", path, err)
		}
	}
	refused := []string{
		root,
		filepath.Join(root, "config"),
		filepath.Join(root, "config", "credentials.json"),
		filepath.Join(root, "state"),
		filepath.Join(root, "state", "conversations.json"),
	}
	for _, path := range refused {
		if _, err := (Policy{Workspace: path}).Container(root); err == nil {
			t.Errorf("%s must never be a container's bind", path)
		}
	}
	// A global is refused the same way: it is the same door.
	if _, err := (Policy{Workspace: filepath.Join(root, "workspaces/work"), Global: []string{filepath.Join(root, "state")}}).Container(root); err == nil {
		t.Error("a private folder named as a global is still private")
	}
	// And the root's own parent is outside it, which is the other rule and still holds.
	if _, err := (Policy{Workspace: root + "-other"}).Container(root); err == nil {
		t.Error("a sibling of the root is outside it")
	}
}
