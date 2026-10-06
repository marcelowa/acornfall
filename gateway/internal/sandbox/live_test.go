package sandbox

import (
	"context"
	"os"
	"path/filepath"
	"testing"
)

// Live: only where a hypervisor exists. Proves the CLI shapes against the real engine.
func TestLiveProduceAndStop(t *testing.T) {
	if os.Getenv("ACORNFALL_LIVE_SANDBOX") == "" {
		t.Skip("set ACORNFALL_LIVE_SANDBOX=1 to boot a real sandbox")
	}
	home := t.TempDir()
	ws := filepath.Join(home, "work")
	if err := os.MkdirAll(ws, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(ws, "hello.txt"), []byte("from the host\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	manager, err := Open(context.Background(), Options{Home: home, Log: t.Logf})
	if err != nil {
		t.Fatal(err)
	}
	if problem := manager.Problem(); problem != nil {
		t.Fatalf("no sandbox on this machine: %v", problem)
	}
	name, err := manager.Produce(context.Background(), Policy{Workspace: ws, Image: "debian:stable-slim", Egress: true}, filepath.Join(home, "state"))
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("sandbox %s", name)
	status, err := manager.Status(context.Background(), ws)
	if err != nil || status == "" {
		t.Fatalf("status %q err %v", status, err)
	}
	if err := manager.Stop(context.Background(), ws); err != nil {
		t.Fatal(err)
	}
	if err := manager.Remove(context.Background(), ws); err != nil {
		t.Fatal(err)
	}
}
