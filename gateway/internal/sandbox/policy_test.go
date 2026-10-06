package sandbox

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

// The install folder holds credentials.json, token, and state/, which an agent must never
// reach. Everything it may read lives in a named resource folder, which is why the mount
// list is spelled out rather than mounting the install and hoping.
func TestGlobalPathsAreTheResourceFoldersAndNeverTheInstall(t *testing.T) {
	home := t.TempDir()
	userHome := t.TempDir()
	if err := EnsureGlobal(home, userHome); err != nil {
		t.Fatal(err)
	}
	for _, folder := range globalFolders(home, userHome) {
		info, err := os.Stat(folder)
		if err != nil || !info.IsDir() {
			t.Errorf("%s should exist after EnsureGlobal: %v", folder, err)
		}
	}

	paths := GlobalPaths(home, userHome)
	want := []string{
		filepath.Join(userHome, ".agents"),
		filepath.Join(home, "agents"),
		filepath.Join(home, "skills"),
		filepath.Join(home, "prompts"),
		filepath.Join(home, "commands"),
	}
	if !slices.Equal(paths, want) {
		t.Errorf("the mounted paths should be the resource folders, got %v want %v", paths, want)
	}
	for _, forbidden := range []string{home, filepath.Join(home, "credentials.json"), filepath.Join(home, "state")} {
		if slices.Contains(paths, forbidden) {
			t.Errorf("%s must never be mounted into a sandbox", forbidden)
		}
	}
}

// The engine refuses a mount of a path that is not there, and a file cannot be created on
// the user's behalf the way an empty folder can: config.json is mounted when it exists, and
// a sandbox made before it was written does not see it until it is recreated.
func TestTheGlobalConfigIsMountedOnlyWhenItExists(t *testing.T) {
	home := t.TempDir()
	userHome := t.TempDir()
	if err := EnsureGlobal(home, userHome); err != nil {
		t.Fatal(err)
	}
	config := filepath.Join(home, "config.json")
	if slices.Contains(GlobalPaths(home, userHome), config) {
		t.Error("an install with no config.json should not mount one")
	}
	if err := os.WriteFile(config, []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	if !slices.Contains(GlobalPaths(home, userHome), config) {
		t.Error("config.json should be mounted once it exists")
	}
}

func TestNameIsStableAndReadable(t *testing.T) {
	name := Name("/home/marcelo/workspace/acornfall")
	if !strings.HasPrefix(name, "acornfall-acornfall-") {
		t.Errorf("name should name the folder, got %q", name)
	}
	if name != Name("/home/marcelo/workspace/acornfall") {
		t.Error("the same workspace must produce the same name; the engine's state is keyed by it")
	}
	if Name("/a/acornfall") == Name("/b/acornfall") {
		t.Error("two folders with the same base name must not share a sandbox")
	}
}

func TestNameSurvivesOddFolders(t *testing.T) {
	for _, path := range []string{"/", "", "///", "/a/../b", "/tmp/weird name!"} {
		name := Name(path)
		if name == "" || strings.ContainsAny(name, " /!") {
			t.Errorf("Name(%q) = %q, which the engine would refuse", path, name)
		}
	}
}
