package sandbox

import (
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
