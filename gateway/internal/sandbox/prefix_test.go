package sandbox

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// A prefix is the one bind whose two sides differ: a folder of the share becomes a system path
// in the container. Everything about it is pinned here, because a prefix that silently becomes
// its own source is a workspace that installs into a folder no shell looks in (ADR 0034).
func TestAPrefixIsMountedAtItsTargetNotItsSource(t *testing.T) {
	policy := Policy{
		Workspace: "/home/me/acornfall/workspaces/app",
		Prefixes: []Prefix{
			{Source: "/home/me/acornfall/workspaces/app/.acornfall/prefix/usr", Target: "/usr/local"},
			{Source: "/home/me/acornfall/workspaces/app/.acornfall/prefix/opt", Target: "/opt"},
		},
	}
	container, err := policy.Container("/home/me/acornfall")
	if err != nil {
		t.Fatal(err)
	}
	var got []Bind
	for _, bind := range container.Binds[1:] {
		if !strings.HasPrefix(bind.Source, filepath.Join("/home/me/acornfall", "workspaces", "app", ".acornfall", "prefix")) {
			continue
		}
		got = append(got, bind)
	}
	if len(got) != 2 {
		t.Fatalf("prefix binds = %+v, want two", got)
	}
	if got[0].Target != "/usr/local" || got[1].Target != "/opt" {
		t.Errorf("targets = %q, %q: a prefix is seen at the path the policy named", got[0].Target, got[1].Target)
	}
	if got[0].Source == got[0].Target {
		t.Error("a prefix whose source is its target is not a prefix: nothing would be writable")
	}
	if got[0].ReadOnly {
		t.Error("a prefix is read-write: installing into it is the whole point")
	}
}

// The set is short on purpose. A bind that can reach /usr, /etc or / can replace the image's own
// programs, which is a different threat from installing a tool.
func TestAPrefixMayOnlyBeMountedAtANamedPath(t *testing.T) {
	for _, target := range PrefixTargets {
		if _, err := prefixBind("/home/me", Prefix{Source: "/home/me/x", Target: target}); err != nil {
			t.Errorf("%s should be a prefix target: %v", target, err)
		}
	}
	for _, target := range []string{"/", "/usr", "/etc", "/bin", "/lib", "/home", "/usr/local/bin", "", "/usr/local/../etc"} {
		if _, err := prefixBind("/home/me", Prefix{Source: "/home/me/x", Target: target}); err == nil {
			t.Errorf("%q was accepted as a prefix target: a workspace could replace the image's own files", target)
		} else if !strings.Contains(err.Error(), "prefix target") {
			t.Errorf("%q: the refusal does not say what the rule is: %v", target, err)
		}
	}
}

// The share root's rule is the same for a prefix as for every other bind, and it is the one that
// keeps a workspace out of the provider key.
func TestAPrefixSourceHasToBeInsideTheShare(t *testing.T) {
	if _, err := prefixBind("/home/me/acornfall", Prefix{Source: "/home/me/acornfall/config", Target: "/usr/local"}); err == nil {
		t.Fatal("a prefix over the private config folder was accepted: that is the provider key")
	}
	if _, err := prefixBind("/home/me/acornfall", Prefix{Source: "/usr/local", Target: "/opt"}); err == nil {
		t.Fatal("a prefix source outside the share was accepted: the machine cannot see it")
	}
	if _, err := prefixBind("/home/me/acornfall", Prefix{Source: "/home/me/acornfall", Target: "/opt"}); err == nil {
		t.Fatal("the share root itself was accepted as a prefix source")
	}
}

// What the workspace gets by default: a folder it already owns, under the dot folder the
// repository ignores, so a toolchain is backed up with the workspace and never committed to it.
func TestDefaultPrefixesLiveInsideTheWorkspace(t *testing.T) {
	workspace := "/home/me/acornfall/workspaces/app"
	prefixes := DefaultPrefixes(workspace)
	if len(prefixes) == 0 {
		t.Fatal("no default prefixes: a workspace would have nowhere to install a tool")
	}
	for _, prefix := range prefixes {
		if !strings.HasPrefix(prefix.Source, filepath.Join(workspace, ".acornfall")) {
			t.Errorf("%s is not under the workspace's own .acornfall folder", prefix.Source)
		}
	}
}

// Beta 55's bug, pinned. The in-machine driver did not make a prefix's source folder, the runtime
// skipped the optional mount, and the workspace installed into a rootfs that was about to be
// thrown away — the tool ran, the file existed, and it was gone. The step lives in
// prepareContainer, which is the one place both drivers go through, so this test is the guard on
// the next driver as much as on this one.
func TestPrepareContainerMakesAPrefixSource(t *testing.T) {
	dir := t.TempDir()
	source := filepath.Join(dir, "prefix", "usr")
	container := Container{
		Name:        "app",
		CPUs:        2,
		MemoryBytes: 1 << 30,
		Binds:       []Bind{{Source: source, Target: "/usr/local"}},
	}
	settings := LXCSettings{
		Dir:         filepath.Join(dir, "container"),
		UID:         os.Getuid(),
		GID:         os.Getgid(),
		MemoryBytes: 1 << 30,
	}
	config, err := prepareContainer(container, settings, filepath.Join(dir, "policy"))
	if err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(source)
	if err != nil {
		t.Fatalf("the prefix source was not made, so the runtime would skip the mount: %v", err)
	}
	if !info.IsDir() {
		t.Error("the prefix source is not a folder")
	}
	if !strings.Contains(string(config), "usr/local") {
		t.Error("the configuration does not mount the prefix at all")
	}
	// The mount replaces the directory, so the layout has to be there or the first install
	// fails with "Directory nonexistent" — the bug the release proof found in beta 55 to 57.
	for _, name := range prefixLayout {
		if info, err := os.Stat(filepath.Join(source, name)); err != nil || !info.IsDir() {
			t.Errorf("the prefix has no %s: the mount would hide the image's and nothing could be installed", name)
		}
	}
}
