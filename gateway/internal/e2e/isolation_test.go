package e2e

import (
	"os"
	"path/filepath"
	"testing"

	"github.com/acornfall/acornfall/gateway/internal/sandbox"
)

// The cleanup once removed every sandbox labelled "acornfall" — the install, not the test —
// so one test finishing deleted another test's running microVM. This pins the smaller list:
// the general workspace and the workspaces created inside this test's own folder.
func TestCleanupNamesOnlyTheSandboxesTheTestOwns(t *testing.T) {
	root := t.TempDir()
	workspaces := filepath.Join(root, "workspaces")
	general := filepath.Join(root, "general")
	owned := filepath.Join(workspaces, "second")
	other := filepath.Join(root, "other-tests-workspaces", "theirs")
	for _, dir := range []string{general, owned, other} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}

	s := &system{General: general, WorkspacesDir: workspaces}
	got := map[string]bool{}
	for _, name := range s.sandboxesOwnedByTest() {
		got[name] = true
	}
	for _, path := range []string{general, owned} {
		if !got[sandbox.Name(path)] {
			t.Errorf("cleanup should name %s, got %v", path, got)
		}
	}
	if got[sandbox.Name(other)] {
		t.Errorf("cleanup must not name another test's sandbox %s", other)
	}
	if len(got) != 2 {
		t.Errorf("cleanup should name exactly the two owned workspaces, got %v", got)
	}
}
