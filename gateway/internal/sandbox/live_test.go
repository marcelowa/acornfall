package sandbox

import (
	"context"
	"errors"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"
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

// Live: the engine of ADR 0021, whole — a machine made by the pinned engine, the shim delivered
// into it over the door, and a workspace's container made, started, listed, stopped and removed
// through the driver. This is the test that says the pieces fit; the shim's own live test says
// what a container does once it exists.
//
//	ACORNFALL_LXC=1 go test ./internal/sandbox -run LiveLXC -v
func TestLiveLXCTheEngineMakesAContainer(t *testing.T) {
	if os.Getenv("ACORNFALL_LXC") == "" {
		t.Skip("set ACORNFALL_LXC=1 to drive a real container runtime")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	// A short home: the engine.s sockets live under its store, and a test.s own long name is a
	// refusal the engine makes on purpose (statePathLimit).
	home := shortTempDir(t)
	engine := NewMicrosandbox(home)
	if state := os.Getenv("ACORNFALL_SANDBOX_STATE"); state != "" {
		engine = engine.WithStateDir(state)
	}
	if err := engine.Install(ctx, t.Logf); err != nil {
		t.Fatal(err)
	}
	if err := engine.Usable(); err != nil {
		t.Skipf("no hypervisor here: %v", err)
	}
	// The machine runs the shim from the gateway's own binary, so the test builds one: the test
	// binary is not the command that has the shim subcommand.
	binary := filepath.Join(t.TempDir(), "acornfall")
	build := exec.CommandContext(ctx, "go", "build", "-o", binary, "./cmd/acornfall")
	build.Dir = "../.."
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatalf("building the binary the machine runs the shim from: %v\n%s", err, out)
	}
	// The share root: a folder of the user's, owned by them and traversable, which is what a
	// container's bind needs to work at all.
	share := filepath.Join("/var/tmp", "acornfall-live-share")
	if err := os.RemoveAll(share); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(share, 0o755); err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(share)
	workspace := filepath.Join(share, "work")
	if err := os.MkdirAll(workspace, 0o755); err != nil {
		t.Fatal(err)
	}
	// The machine's image has to carry the container runtime, and the appliance image that will is
	// not built yet. Installing it through the engine's exec is the one thing that exec is bad at
	// (ADR 0012: the CLI is for lifecycle, the SDK for execution) — measured here, a long install
	// loses its session and leaves dpkg interrupted — so what this test checks is the chain up to
	// the runtime, and the rest runs when the image exists (or when ACORNFALL_MACHINE_IMAGE names
	// one that carries it). The container's own life is the shim's live test, against a real
	// runtime.
	image := os.Getenv("ACORNFALL_MACHINE_IMAGE")
	// No flat root disk here: the machine shares this guest's disk, and a preallocated gigabyte
	// is more than it has. A real install wants the flat disk (machine.go), and that flag is
	// unit-tested; what this test is for is the chain.
	driver := NewLXC(engine, Machine{
		Image:     image,
		CPUs:      2,
		Memory:    "1G",
		ShareRoot: share,
	}, filepath.Join(home, "state", "machine.sock"), binary).WithLog(t.Logf)
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		if err := driver.Remove(cleanup, Name(workspace)); err != nil {
			t.Logf("removing the container: %v", err)
		}
		if err := driver.machine.RemoveMachine(cleanup); err != nil {
			t.Logf("removing the machine: %v", err)
		}
	}()
	if err := driver.EnsureMachine(ctx); err != nil {
		t.Fatal(err)
	}
	// What the shim says when it cannot reach the door is the only account of why: dump it.
	defer func() {
		show, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()
		out := exec.CommandContext(show, engine.binary(), "exec", driver.machine.Name(), "--", "cat", "/var/log/acornfall-shim.log")
		out.Env = append(os.Environ(), engine.Env()...)
		if text, err := out.CombinedOutput(); err == nil {
			t.Logf("the shim's log inside the machine:\n%s", text)
		}
	}()
	// The chain, all of it: the machine is made, the shim is delivered into it, the door connects,
	// and the handshake answers. A machine whose image has no runtime answers that too, which is
	// where this stops until the appliance image exists.
	if _, err := driver.List(ctx); err != nil {
		if errors.Is(err, ErrUnavailable) {
			t.Skipf("the machine's image has no container runtime yet: %v", err)
		}
		t.Fatal(err)
	}
	policy := Policy{Workspace: workspace, Image: "debian:stable-slim", CPUs: 1, Memory: "512M"}
	name := Name(workspace)
	if err := driver.Create(ctx, policy, t.TempDir()); err != nil {
		t.Fatal(err)
	}
	instances, err := driver.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, instance := range instances {
		if instance.Name == name {
			found = true
			if instance.Running() {
				t.Errorf("%s should not be running before it is started", name)
			}
		}
	}
	if !found {
		t.Fatalf("%s is not among %v", name, instances)
	}
	if err := driver.Start(ctx, name); err != nil {
		t.Fatal(err)
	}
	manager := &Manager{driver: driver, home: home}
	status, err := manager.Status(ctx, workspace)
	if err != nil {
		t.Fatal(err)
	}
	if status != "RUNNING" {
		t.Fatalf("status = %q, want the container running", status)
	}
	if err := driver.Stop(ctx, name); err != nil {
		t.Fatal(err)
	}
	if err := driver.Remove(ctx, name); err != nil {
		t.Fatal(err)
	}
}
