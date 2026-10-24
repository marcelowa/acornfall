package control

import (
	"github.com/acornfall/acornfall/gateway/internal/layout"
	"os"
	"path/filepath"
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

// A key this build no longer writes is dropped the next time the registry is read: a stale
// value that nothing reads is a value something can read again by accident.
func TestARegistryFromAnOlderBuildIsRewrittenWithoutOldKeys(t *testing.T) {
	dir := t.TempDir()
	// The registry lives in the root's state folder (ADR 0022).
	where := layout.New(dir, dir)
	path := where.Registry()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	legacy := `{
  "workspacesDir": "` + dir + `/workspaces",
  "workspaces": [
    {"name": "general", "path": "` + dir + `/general", "title": "general", "general": true, "trusted": true},
    {"name": "old", "path": "` + dir + `/old", "title": "old", "trusted": false}
  ]
}`
	if err := os.WriteFile(path, []byte(legacy), 0o600); err != nil {
		t.Fatal(err)
	}

	workspaces := NewWorkspaces(WorkspacesOptions{Layout: where})
	if err := workspaces.loadRegistry(); err != nil {
		t.Fatal(err)
	}
	if len(workspaces.List()) != 2 {
		t.Fatalf("both workspaces should load, got %d", len(workspaces.List()))
	}

	payload, err := os.ReadFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(payload), "trusted") {
		t.Errorf("the registry should have been rewritten without the dropped key:\n%s", payload)
	}
	// And what it did say is intact.
	reloaded, err := LoadRegistryFile(path)
	if err != nil {
		t.Fatal(err)
	}
	if len(reloaded.Workspaces) != 2 || reloaded.Workspaces[1].Path != filepath.Join(dir, "old") {
		t.Errorf("the rewrite lost something: %+v", reloaded.Workspaces)
	}
}

// Nesting is allowed unless refused, and whose refusal it is matters: the install's flag
// is the default, a workspace's own setting wins over it, and nil is not false — it is
// "follow the install", which is exactly why the field is a pointer.
func TestNestingFollowsTheInstallUnlessTheWorkspaceChooses(t *testing.T) {
	const home, userHome = "/home/me/.acornfall", "/home/me"
	on, off := true, false
	cases := []struct {
		name      string
		workspace *bool
		install   bool
		want      bool
	}{
		{"no setting follows an install that allows", nil, false, false},
		{"no setting follows an install that refuses", nil, true, true},
		{"a workspace can refuse what the install allows", &on, false, true},
		{"a workspace can allow what the install refuses", &off, true, false},
	}
	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			workspace := Workspace{DisableVMNesting: test.workspace}
			got := workspace.SandboxPolicy(home, test.install).DisableVMNesting
			if got != test.want {
				t.Errorf("DisableVMNesting = %t, want %t", got, test.want)
			}
		})
	}
}

// The policy is derived so a new field cannot be forgotten in one of the two places. The prefix
// is the newest example: every workspace gets one, and it has to survive the derivation intact
// (ADR 0034).
func TestAWorkspacesPolicyCarriesItsWritablePrefix(t *testing.T) {
	const share = "/home/me/acornfall"
	workspace := Workspace{Path: share + "/workspaces/app"}
	policy := workspace.SandboxPolicy(share, false)
	if len(policy.Prefixes) == 0 {
		t.Fatal("no prefixes in the policy: a workspace could not install a tool into itself")
	}
	container, err := policy.Container(share)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, bind := range container.Binds {
		if bind.Target != "/usr/local" {
			continue
		}
		found = true
		if bind.ReadOnly {
			t.Error("/usr/local is read-only: nothing could be installed")
		}
		if bind.Source == bind.Target {
			t.Error("source and target are the same path: the bind would shadow nothing")
		}
		if !strings.HasPrefix(bind.Source, share) {
			t.Errorf("prefix source %s is outside the share: the machine cannot see it", bind.Source)
		}
	}
	if !found {
		t.Fatalf("the container has no /usr/local bind: %+v", container.Binds)
	}
}
