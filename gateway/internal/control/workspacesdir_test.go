package control

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/acornfall/acornfall/gateway/internal/layout"
	"github.com/acornfall/acornfall/gateway/internal/sandbox"
)

// The workspaces folder is inside the mount, because that is the only place the machine can see.
//
// The appliance runs with no home of its own and a root it was told: taking the workspaces folder from $HOME
// put new workspaces at /acornfall/workspaces, outside the machine's share root. The machine cannot mount
// that, so the sandbox was never made, and every workspace created there opened with no tools and one sentence
// saying so — with the reason in a log on another machine.
func TestWorkspacesLiveInsideTheMountWhenThereIsNoHome(t *testing.T) {
	t.Setenv("HOME", "")
	root := t.TempDir()
	where := layout.New(root, filepath.Join(root, ".acornfall"))
	workspaces := NewWorkspaces(WorkspacesOptions{Layout: where})
	if err := workspaces.loadRegistry(); err != nil {
		t.Fatal(err)
	}
	if got, want := workspaces.Dir(), filepath.Join(root, "workspaces"); got != want {
		t.Errorf("the workspaces folder is %q, want %q", got, want)
	}
	// And a workspace created there is inside the root the machine mounts, which is what the sandbox needs.
	workspace, err := workspaces.Create("dev")
	if err != nil {
		t.Fatal(err)
	}
	if got, want := workspace.Path, filepath.Join(root, "workspaces", "dev"); got != want {
		t.Errorf("a new workspace is at %q, want %q", got, want)
	}
}

// A workspace the gateway makes belongs to the share's owner. The gateway inside the machine
// runs as root; without the owner, the console creates root-owned folders and the person's tools
// (which run as the share owner) cannot write their own workspace.
func TestANewWorkspaceBelongsToTheSharesOwner(t *testing.T) {
	if os.Geteuid() != 0 {
		t.Skip("giving a folder to a different owner needs root")
	}
	root := t.TempDir()
	if err := os.Chown(root, 12345, 12345); err != nil {
		t.Fatal(err)
	}
	where := layout.New(root, filepath.Join(root, ".acornfall"))
	workspaces := NewWorkspaces(WorkspacesOptions{Layout: where})
	if err := workspaces.loadRegistry(); err != nil {
		t.Fatal(err)
	}
	workspace, err := workspaces.Create("dev")
	if err != nil {
		t.Fatal(err)
	}
	uid, gid, ok := sandbox.ShareOwner(workspace.Path)
	if !ok || uid != 12345 || gid != 12345 {
		t.Errorf("a workspace made inside the share should belong to its owner, got %d:%d (%v)", uid, gid, ok)
	}
}

// A workspace copied in from an older root install was created before the machine's mount, so
// inside the machine it maps to uid 0 and the container sees nobody. The gateway repairs it on
// open by giving it to the share's owner; a new workspace already has that owner.
func TestAnOlderWorkspaceDirectoryIsGivenToTheSharesOwner(t *testing.T) {
	if os.Geteuid() != 0 {
		t.Skip("giving a folder to a different owner needs root")
	}
	root := t.TempDir()
	if err := os.Chown(root, 12345, 12345); err != nil {
		t.Fatal(err)
	}
	where := layout.New(root, filepath.Join(root, ".acornfall"))
	workspaces := NewWorkspaces(WorkspacesOptions{Layout: where})
	if err := workspaces.loadRegistry(); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(root, "workspaces", "old")
	if err := os.MkdirAll(path, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.Chown(path, 0, 0); err != nil {
		t.Fatal(err)
	}
	if err := workspaces.Add(Workspace{Name: "old", Path: path}); err != nil {
		t.Fatal(err)
	}
	workspaces.adoptOwnership()
	uid, gid, ok := sandbox.ShareOwner(path)
	if !ok || uid != 12345 || gid != 12345 {
		t.Errorf("an older workspace should belong to the share's owner, got %d:%d (%v)", uid, gid, ok)
	}
}
