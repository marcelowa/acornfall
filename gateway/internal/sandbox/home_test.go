package sandbox

import (
	"path/filepath"
	"strings"
	"testing"
)

// The home is a folder of the share at a fixed path, like a prefix and for the same reason: a
// home inside the rootfs is thrown away with the container. Unlike a prefix it is not a tool
// install, so it is not in PrefixTargets — the path is the engine's, not a policy's.
func TestTheHomeIsBoundAtAFixedPath(t *testing.T) {
	policy := Policy{
		Workspace: "/home/me/acornfall/workspaces/app",
		Home:      "/home/me/acornfall/workspaces/app/.acornfall/home",
	}
	container, err := policy.Container("/home/me/acornfall")
	if err != nil {
		t.Fatal(err)
	}
	var home *Bind
	for i := range container.Binds {
		if container.Binds[i].Target == ContainerHome {
			home = &container.Binds[i]
		}
	}
	if home == nil {
		t.Fatalf("no bind at %s: ~ would be the image's, and the image's is in the rootfs", ContainerHome)
	}
	if home.ReadOnly {
		t.Error("a read-only home: nothing could write its own settings")
	}
	if home.Source == home.Target {
		t.Error("the home's source is its target: it would be the workspace's path, not a folder of its own")
	}
	if home.Source != policy.Home {
		t.Errorf("home source = %q, want the policy's %q", home.Source, policy.Home)
	}
}

// A policy that names no home keeps the image's, which is what every caller before ADR 0035 had.
func TestAPolicyWithNoHomeIsLeftAlone(t *testing.T) {
	policy := Policy{Workspace: "/home/me/acornfall/workspaces/app"}
	container, err := policy.Container("/home/me/acornfall")
	if err != nil {
		t.Fatal(err)
	}
	for _, bind := range container.Binds {
		if bind.Target == ContainerHome {
			t.Fatalf("a home was invented for a policy that named none: %+v", bind)
		}
	}
}

// The share root's rule is not suspended for the home: a home at the root would hand a container
// every workspace and the provider key with them.
func TestAHomeOutsideTheShareIsRefused(t *testing.T) {
	policy := Policy{
		Workspace: "/home/me/acornfall/workspaces/app",
		Home:      "/home/me/acornfall/config",
	}
	if _, err := policy.Container("/home/me/acornfall"); err == nil {
		t.Fatal("a home over the private config folder was accepted: that is the provider key")
	}
}

// Where the default lives: inside the workspace, under the dot folder it already owns, so it is
// backed up with the workspace and never committed to it.
func TestTheDefaultHomeIsNotTheRepository(t *testing.T) {
	workspace := "/home/me/acornfall/workspaces/app"
	home := DefaultHome(workspace)
	if !strings.HasPrefix(home, filepath.Join(workspace, ".acornfall")) {
		t.Errorf("home %q is not under the workspace's own .acornfall folder", home)
	}
	if home == workspace {
		t.Error("the default home is the workspace itself: ~ would be the repository root")
	}
}
