package layout

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestTheTwoFoldersAreWhereADR0022SaysTheyAre(t *testing.T) {
	l := New("/home/me/acornfall", "/home/me/.acornfall")
	for _, want := range []struct {
		got  string
		want string
	}{
		{l.Bundle(), "/home/me/acornfall/.agents"},
		{l.ConfigFile(), "/home/me/acornfall/config/config.json"},
		{l.Credentials(), "/home/me/acornfall/config/credentials.json"},
		{l.Token(), "/home/me/acornfall/config/token"},
		{l.WorkspaceState("work"), "/home/me/acornfall/state/work"},
		{l.Registry(), "/home/me/acornfall/state/workspaces.json"},
		{l.Workspaces(), "/home/me/acornfall/workspaces"},
		{l.Tools(), "/home/me/.acornfall/tools"},
		{l.Store(), "/home/me/.acornfall/sandboxes"},
	} {
		if want.got != want.want {
			t.Errorf("got %s, want %s", want.got, want.want)
		}
	}
}

// The move, and the two things that make it safe: a file already at its destination is left
// alone, and nothing is deleted — a migration that removes things is one nobody can undo.
func TestMigrateMovesThePublicFilesOnce(t *testing.T) {
	home := t.TempDir()
	root := filepath.Join(t.TempDir(), "acornfall")
	old := New(root, home)
	if err := os.MkdirAll(filepath.Join(home, "state", "work"), 0o700); err != nil {
		t.Fatal(err)
	}
	files := map[string]string{
		"skills/review/SKILL.md":    "a skill",
		"agents/reviewer.md":        "an agent",
		"config.json":               "{}",
		"settings.json":             `{"model":"faux/faux-1"}`,
		"credentials.json":          `{"openai":{"apiKey":"secret"}}`,
		"token":                     "a-token",
		"workspaces.json":           `{"workspaces":[]}`,
		"state/work/session.sqlite": "a database",
		"session.sqlite":            "an older database",
	}
	for name, content := range files {
		path := filepath.Join(home, name)
		if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(content), 0o600); err != nil {
			t.Fatal(err)
		}
	}
	var logged []string
	if err := Migrate(old, func(format string, args ...any) { logged = append(logged, format) }); err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		filepath.Join(root, ".agents", "skills", "review", "SKILL.md"),
		filepath.Join(root, ".agents", "agents", "reviewer.md"),
		filepath.Join(root, "config", "config.json"),
		filepath.Join(root, "config", "settings.json"),
		filepath.Join(root, "config", "credentials.json"),
		filepath.Join(root, "config", "token"),
		filepath.Join(root, "state", "workspaces.json"),
		filepath.Join(root, "state", "work", "session.sqlite"),
		filepath.Join(root, "state", "session.sqlite"),
	} {
		if _, err := os.Stat(want); err != nil {
			t.Errorf("%s should be there after the move: %v", want, err)
		}
	}
	if len(logged) < 8 {
		t.Errorf("every move is a line somebody can read, got %d", len(logged))
	}

	// Running it again changes nothing, and does not overwrite what is already there.
	if err := os.WriteFile(filepath.Join(root, "config", "credentials.json"), []byte("the new one"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := Migrate(old, nil); err != nil {
		t.Fatal(err)
	}
	content, err := os.ReadFile(filepath.Join(root, "config", "credentials.json"))
	if err != nil {
		t.Fatal(err)
	}
	if string(content) != "the new one" {
		t.Errorf("a second run must not overwrite, got %q", content)
	}
}

// A fresh install has nothing to move, and the folders are made so the first write lands.
func TestMigrateOnAFreshInstallOnlyMakesTheFolders(t *testing.T) {
	home := filepath.Join(t.TempDir(), "home")
	root := filepath.Join(t.TempDir(), "root")
	if err := Migrate(New(root, home), nil); err != nil {
		t.Fatal(err)
	}
	for _, dir := range []string{root, filepath.Join(root, ".agents"), filepath.Join(root, "config"), filepath.Join(root, "state"), filepath.Join(root, "workspaces"), home, filepath.Join(home, "tools")} {
		if info, err := os.Stat(dir); err != nil || !info.IsDir() {
			t.Errorf("%s should exist: %v", dir, err)
		}
	}
}

func TestUnderIsAboutFoldersNotText(t *testing.T) {
	if !Under("/home/me/acornfall", "/home/me/acornfall/workspaces/work") {
		t.Error("a workspace is under the root")
	}
	if Under("/home/me/acornfall", "/home/me/acornfall-other/work") {
		t.Error("a sibling that shares a prefix is not under it")
	}
	if Under("/home/me/acornfall", "/home/me/acornfall") {
		t.Error("the root is not under itself: a bind of it is every workspace at once")
	}
	if !strings.HasPrefix(New("/r", "/h").Share, "/") {
		t.Error("paths stay as they were given")
	}
}
