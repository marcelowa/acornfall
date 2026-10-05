package control

import (
	"strings"
	"testing"
)

// Where workspaces live is a decision someone makes, not one to guess.
//
// Without a home directory the old code fell back to a relative "acornfall/workspaces", which
// put workspaces wherever the process happened to start — a folder nobody chose, appearing in a
// container's working directory. An error names the flag that settles it instead.
func TestNoHomeDirectoryIsAnErrorNotAGuess(t *testing.T) {
	t.Setenv("HOME", "")

	dir, err := DefaultWorkspacesDir()
	if err == nil {
		t.Fatalf("expected an error with no home directory, got %q", dir)
	}
	if !strings.Contains(err.Error(), "--workspaces-dir") {
		t.Errorf("the error should name the flag that fixes it, got %q", err)
	}
	if strings.Contains(dir, "acornfall") {
		t.Errorf("no path should be invented, got %q", dir)
	}
}
