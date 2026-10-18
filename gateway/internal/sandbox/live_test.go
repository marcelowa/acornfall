package sandbox

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// liveDriver is the real engine, with its state directory shared when the environment names
// one. A fresh directory per run means a fresh pull of the image every run, which is how a
// suite meets a registry's anonymous rate limit; the shared directory is also what the e2e
// suite's image cache is.
func liveDriver(home string) *Microsandbox {
	driver := NewMicrosandbox(home)
	if state := os.Getenv("ACORNFALL_SANDBOX_STATE"); state != "" {
		driver = driver.WithStateDir(state)
	}
	return driver
}

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
	manager, err := Open(context.Background(), Options{Home: home, Driver: liveDriver(home), Log: t.Logf})
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

// Live: the machine half of ADR 0021, against the real engine. The per-workspace driver never
// had to do this: create one VM for the install, and leave it alone the second time. What lives
// inside it — the containers — arrives with the transport for LXC.
func TestLiveTheMachineIsCreatedOnceAndBootedAgain(t *testing.T) {
	if os.Getenv("ACORNFALL_LIVE_SANDBOX") == "" {
		t.Skip("set ACORNFALL_LIVE_SANDBOX=1 to boot a real machine")
	}
	home := t.TempDir()
	driver := liveDriver(home)
	ctx := context.Background()
	if err := driver.Install(ctx, t.Logf); err != nil {
		t.Fatal(err)
	}
	if err := driver.Usable(); err != nil {
		t.Fatalf("no sandbox on this machine: %v", err)
	}
	machine := NewMachineEngine(driver, Machine{
		CPUs:   2,
		Memory: "1G",
		Disk:   "flat:1G",
		Egress: true,
	}, filepath.Join(home, "state"))
	defer func() {
		if err := machine.RemoveMachine(ctx); err != nil {
			t.Errorf("removing the machine: %v", err)
		}
	}()
	if err := machine.EnsureMachine(ctx); err != nil {
		t.Fatal(err)
	}
	name := machine.Name()
	status := func() string {
		t.Helper()
		instances, err := driver.List(ctx)
		if err != nil {
			t.Fatal(err)
		}
		count := 0
		found := ""
		for _, instance := range instances {
			if instance.Name == name {
				count++
				found = instance.Status
			}
		}
		if count != 1 {
			t.Fatalf("want exactly one machine named %s, got %d", name, count)
		}
		return found
	}
	if got := status(); !strings.EqualFold(got, "running") {
		t.Fatalf("the machine should be running, got %q", got)
	}
	// Asking again, with the machine up, creates nothing and starts nothing.
	if err := machine.EnsureMachine(ctx); err != nil {
		t.Fatal(err)
	}
	if got := status(); !strings.EqualFold(got, "running") {
		t.Fatalf("the machine should still be running, got %q", got)
	}
	// A stopped machine is booted again, and it is the same machine: one instance, not two.
	if err := driver.Stop(ctx, name); err != nil {
		t.Fatal(err)
	}
	if got := status(); strings.EqualFold(got, "running") {
		t.Fatalf("the machine should be stopped, got %q", got)
	}
	if err := machine.EnsureMachine(ctx); err != nil {
		t.Fatal(err)
	}
	if got := status(); !strings.EqualFold(got, "running") {
		t.Fatalf("the stopped machine should be running again, got %q", got)
	}
}
