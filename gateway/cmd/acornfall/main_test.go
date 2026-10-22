package main

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/acornfall/acornfall/gateway/internal/control"
	"github.com/acornfall/acornfall/gateway/internal/layout"
)

// A workspace added from the command line has to be one the gateway sees: the registry lives
// in the mount, and this command used to write it into the machinery folder instead.
func TestWorkspaceAddWritesTheRegistryTheGatewayReads(t *testing.T) {
	root, home, folder := t.TempDir(), t.TempDir(), t.TempDir()
	// Flags after the operands, which is how the usage line reads them.
	workspaceCommand([]string{"add", "lab", folder, "--image", "golang:1.24", "--share", root, "--data-dir", home})

	where := layout.New(root, home)
	registry, err := control.LoadRegistryFile(where.Registry())
	if err != nil {
		t.Fatalf("the gateway's registry is not there: %v", err)
	}
	if len(registry.Workspaces) != 1 || registry.Workspaces[0].Name != "lab" {
		t.Fatalf("the registry the gateway reads holds %+v", registry.Workspaces)
	}
	if got := registry.Workspaces[0].Image; got != "golang:1.24" {
		t.Errorf("a flag written after the folder is still the workspace's image, got %q", got)
	}
	if _, err := os.Stat(filepath.Join(home, "workspaces.json")); err == nil {
		t.Error("the registry was also written to the machinery folder, where nothing reads it")
	}
}
