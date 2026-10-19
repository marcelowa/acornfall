package sandbox

import (
	"os"
	"path/filepath"
	"slices"
	"strings"
	"testing"
)

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

// One bundle, in the folder the machine mounts, and the install's config file when it exists.
// The root holds the credential and every workspace's state beside it, which is why the mount
// list is spelled out rather than mounting the root and hoping (ADR 0014, ADR 0022).
func TestGlobalPathsAreTheBundleAndNeverTheRootsPrivateFiles(t *testing.T) {
	root := t.TempDir()
	if err := EnsureGlobal(root); err != nil {
		t.Fatal(err)
	}
	bundle := filepath.Join(root, ".agents")
	if info, err := os.Stat(bundle); err != nil || !info.IsDir() {
		t.Errorf("%s should exist after EnsureGlobal: %v", bundle, err)
	}
	if paths := GlobalPaths(root); !slices.Equal(paths, []string{bundle}) {
		t.Errorf("the mounted paths should be the bundle alone, got %v", paths)
	}

	config := filepath.Join(root, "config", "config.json")
	if err := os.MkdirAll(filepath.Dir(config), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(config, []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	if paths := GlobalPaths(root); !slices.Contains(paths, config) {
		t.Errorf("an existing config.json is mounted read-only, got %v", paths)
	}

	for _, forbidden := range []string{
		root,
		filepath.Join(root, "config"),
		filepath.Join(root, "config", "credentials.json"),
		filepath.Join(root, "config", "token"),
		filepath.Join(root, "state"),
	} {
		if slices.Contains(GlobalPaths(root), forbidden) {
			t.Errorf("%s must never be mounted into a sandbox", forbidden)
		}
	}
}
