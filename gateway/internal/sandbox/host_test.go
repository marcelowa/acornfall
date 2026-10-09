package sandbox

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The host engine is the one that needs nothing: no hypervisor, no install, no state. A
// machine that cannot sandbox can still run a workspace on it, which is its whole point.
func TestTheHostEngineNeedsNothing(t *testing.T) {
	host := NewHost()
	if host.Name() != "host" {
		t.Errorf("engine name = %q, want host", host.Name())
	}
	if !host.Installed() {
		t.Error("the host engine is always installed; there is nothing to fetch")
	}
	if err := host.Usable(); err != nil {
		t.Errorf("the host engine is always usable: %v", err)
	}
	if err := host.Install(context.Background(), t.Logf); err != nil {
		t.Errorf("installing the host engine should do nothing: %v", err)
	}
	if instances, err := host.List(context.Background()); err != nil || len(instances) != 0 {
		t.Errorf("the host engine lists nothing, got %v %v", instances, err)
	}
	policy := Policy{Workspace: t.TempDir()}
	for _, call := range []error{
		host.Create(context.Background(), policy, t.TempDir()),
		host.Start(context.Background(), "anything"),
		host.Stop(context.Background(), "anything"),
		host.Remove(context.Background(), "anything"),
	} {
		if call != nil {
			t.Errorf("a lifecycle call on the host engine should do nothing: %v", call)
		}
	}
}

// Isolation is what the microVM engine is for and what the host engine cannot offer; every
// surface that describes a sandbox reports this, so it is pinned.
func TestIsolationSaysWhichEngineSeparatesFromTheHost(t *testing.T) {
	if !NewMicrosandbox(t.TempDir()).Isolated() {
		t.Error("a microVM separates commands from the host")
	}
	if NewHost().Isolated() {
		t.Error("the host engine is not isolated, and the report must not claim it is")
	}
}

// Nesting is refused by name: the host engine has no sandbox to nest, and a "yes" here
// would put a nesting badge over a run that has the whole machine already.
func TestHostSaysThereIsNothingToNest(t *testing.T) {
	support := NewHost().Nesting(context.Background())
	if support.Available {
		t.Error("the host engine cannot nest anything: it is not a sandbox")
	}
	if support.Reason == "" {
		t.Error("a refusal has to say why, because doctor prints it")
	}
}

// Engine is how a run names what it wants. A name nobody implements is refused with the
// choices: defaulting to the host for a typo would turn a sandboxed run unconfined.
func TestEngineRefusesANameItDoesNotImplement(t *testing.T) {
	home := t.TempDir()
	driver, err := Engine(home, "", "")
	if err != nil || driver.Name() != "microsandbox" {
		t.Fatalf("the default engine is microsandbox, got %v %v", driver, err)
	}
	driver, err = Engine(home, "/tmp/somewhere", "microsandbox")
	if err != nil {
		t.Fatal(err)
	}
	if driver.StateDir() != "/tmp/somewhere" {
		t.Errorf("the state directory should reach the driver, got %q", driver.StateDir())
	}
	driver, err = Engine(home, "", "host")
	if err != nil || driver.Name() != "host" {
		t.Fatalf("host should be selectable, got %v %v", driver, err)
	}
	_, err = Engine(home, "", "sandbox-exec")
	if err == nil || !strings.Contains(err.Error(), "host") || !strings.Contains(err.Error(), "microsandbox") {
		t.Errorf("an unknown engine should name the choices, got %v", err)
	}
}

// The manager's report carries the isolation flag and the produced sandbox works without an
// install: this is the path a host-engine workspace takes.
func TestTheHostEngineProduceAndReport(t *testing.T) {
	home := t.TempDir()
	workspace := filepath.Join(home, "work")
	if err := os.MkdirAll(workspace, 0o755); err != nil {
		t.Fatal(err)
	}
	manager, err := Open(context.Background(), Options{Home: home, Driver: NewHost()})
	if err != nil {
		t.Fatal(err)
	}
	name, err := manager.Produce(context.Background(), Policy{Workspace: workspace}, t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	if name != Name(workspace) {
		t.Errorf("the produced name should be the workspace's, got %q", name)
	}
	report := manager.Report()
	if report.Engine != "host" || report.Isolated {
		t.Errorf("the report should say host and not isolated, got %+v", report)
	}
	if err := manager.Stop(context.Background(), workspace); err != nil {
		t.Errorf("stopping a host workspace should do nothing: %v", err)
	}
	if err := manager.Remove(context.Background(), workspace); err != nil {
		t.Errorf("removing a host workspace should do nothing: %v", err)
	}
}
