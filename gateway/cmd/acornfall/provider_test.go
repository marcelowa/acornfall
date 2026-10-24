package main

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/acornfall/acornfall/gateway/internal/layout"
)

// A key added from the command line lands in the mount, where the appliance reads it, and a
// flag written after the operand is not ignored on the way.
func TestProviderAddWritesTheKeyIntoTheMount(t *testing.T) {
	root, home := t.TempDir(), t.TempDir()
	providers([]string{"add", "openai", "sk-test", "--share", root, "--data-dir", home})

	path := layout.New(root, home).Credentials()
	payload, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("no credentials in the mount: %v", err)
	}
	var all map[string]struct{ Key string }
	if err := json.Unmarshal(payload, &all); err != nil {
		t.Fatal(err)
	}
	if all["openai"].Key != "sk-test" {
		t.Errorf("the mount holds %+v", all)
	}
	if _, err := os.Stat(filepath.Join(home, "credentials.json")); err == nil {
		t.Error("a copy was left in the machinery folder")
	}
}
