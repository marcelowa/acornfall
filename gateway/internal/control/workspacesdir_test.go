package control

import (
	"path/filepath"

	"github.com/acornfall/acornfall/gateway/internal/layout"
	"testing"
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
