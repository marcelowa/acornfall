package update

import (
	"os"
	"strings"
	"testing"
	"time"
)

// The phase is what the console blocks on. It is derived from the two files the host and the
// product already write, and from the build this process runs.
func TestTheUpdatePhaseFollowsWantAndTheHost(t *testing.T) {
	root := t.TempDir()
	manager := New(t.TempDir(), root, "", "")
	manager.WithLauncherOwner()
	manager.current = "v0.10.0-beta.46"

	if got := manager.Status(); got.Phase != PhaseIdle || got.Blocking {
		t.Fatalf("no want should be idle, got %+v", got.Phase)
	}

	if err := WriteWant(root, "v0.10.0-beta.47"); err != nil {
		t.Fatal(err)
	}
	requested := manager.Status()
	if requested.Phase != PhaseRequested || !requested.Blocking || requested.Target != "v0.10.0-beta.47" {
		t.Fatalf("old console with a want should be requested and blocking, got %+v", requested)
	}

	// The new machine is up; the host service is still the old one.
	manager.current = "v0.10.0-beta.47"
	if err := WriteIs(root, HostState{Running: true, Version: "v0.10.0-beta.47", Service: "v0.10.0-beta.46"}); err != nil {
		t.Fatal(err)
	}
	starting := manager.Status()
	if starting.Phase != PhaseStarting || !starting.Blocking {
		t.Fatalf("machine on the target with an old host should be starting and blocking, got %+v", starting)
	}

	// The host took step two.
	if err := WriteIs(root, HostState{Running: true, Version: "v0.10.0-beta.47", Service: "v0.10.0-beta.47"}); err != nil {
		t.Fatal(err)
	}
	ready := manager.Status()
	if ready.Phase != PhaseReady || ready.Blocking {
		t.Fatalf("both sides on the target should be ready, got %+v", ready)
	}
}

func TestAnUpdateThatFailsLiftsTheBlock(t *testing.T) {
	root := t.TempDir()
	manager := New(t.TempDir(), root, "", "")
	manager.WithLauncherOwner()
	manager.current = "v0.10.0-beta.46"
	if err := WriteWant(root, "v0.10.0-beta.47"); err != nil {
		t.Fatal(err)
	}
	if err := WriteIs(root, HostState{Running: true, Version: "v0.10.0-beta.46", Service: "v0.10.0-beta.46", LastError: "applying v0.10.0-beta.47: no route"}); err != nil {
		t.Fatal(err)
	}
	status := manager.Status()
	if status.Phase != PhaseFailed || status.Blocking || !strings.Contains(status.PhaseReason, "no route") {
		t.Fatalf("a host error should be failed and unblocked, got %+v", status)
	}
}

func TestAnUpdateThatStopsAnsweringStopsBlocking(t *testing.T) {
	root := t.TempDir()
	manager := New(t.TempDir(), root, "", "")
	manager.WithLauncherOwner()
	manager.current = "v0.10.0-beta.46"
	if err := WriteWant(root, "v0.10.0-beta.47"); err != nil {
		t.Fatal(err)
	}
	if err := WriteIs(root, HostState{Running: true, Version: "v0.10.0-beta.46", Service: "v0.10.0-beta.46"}); err != nil {
		t.Fatal(err)
	}
	manager.blockingTarget = "v0.10.0-beta.47"
	manager.blockingSince = time.Now().Add(-updateBlockMax - time.Minute)
	status := manager.Status()
	if status.Phase != PhaseFailed || status.Blocking || !strings.Contains(status.PhaseReason, "15 minutes") {
		t.Fatalf("an update past its bound should fail and unblock, got %+v", status)
	}
}

// is.json is replaced every second on the machine's share. A read that misses the rename is
// not the host going away; the last good state bridges a short window instead of flapping the
// phase back to starting and blocking writes.
func TestATransientMissingIsKeepsTheReadyPhase(t *testing.T) {
	root := t.TempDir()
	manager := New(t.TempDir(), root, "", "")
	manager.WithLauncherOwner()
	manager.current = "v0.10.0-beta.50"
	if err := WriteWant(root, "v0.10.0-beta.50"); err != nil {
		t.Fatal(err)
	}
	if err := WriteIs(root, HostState{Running: true, Version: "v0.10.0-beta.50", Service: "v0.10.0-beta.50"}); err != nil {
		t.Fatal(err)
	}
	if got := manager.Status(); got.Phase != PhaseReady {
		t.Fatalf("fixture is not ready: %+v", got.Phase)
	}
	if err := os.Remove(IsPath(root)); err != nil {
		t.Fatal(err)
	}
	if got := manager.Status(); got.Phase != PhaseReady || got.Blocking {
		t.Fatalf("a missing read flapped the phase: %+v", got)
	}
	manager.hostMu.Lock()
	manager.lastHostAt = time.Now().Add(-hostCacheGrace - time.Second)
	manager.hostMu.Unlock()
	if got := manager.Status(); got.Phase != PhaseStarting || !got.Blocking {
		t.Fatalf("a host that stayed away should be starting and blocking, got %+v", got)
	}
}

// A ready state must not be undone by an older is.json still visible on the machine share
// after the host wrote the newer one. At is the host's own clock; the newer state wins.
func TestAStaleHostReadDoesNotUndoReady(t *testing.T) {
	root := t.TempDir()
	manager := New(t.TempDir(), root, "", "")
	manager.WithLauncherOwner()
	manager.current = "v0.10.0-beta.53"
	if err := WriteWant(root, "v0.10.0-beta.53"); err != nil {
		t.Fatal(err)
	}
	if err := WriteIs(root, HostState{
		Running: true,
		Version: "v0.10.0-beta.53",
		Service: "v0.10.0-beta.53",
		At:      "2026-10-23T10:00:02Z",
	}); err != nil {
		t.Fatal(err)
	}
	if got := manager.Status(); got.Phase != PhaseReady || got.Blocking {
		t.Fatalf("fixture is not ready: %+v", got)
	}
	if err := WriteIs(root, HostState{
		Running: true,
		Version: "v0.10.0-beta.53",
		Service: "v0.10.0-beta.52",
		At:      "2026-10-23T10:00:01Z",
	}); err != nil {
		t.Fatal(err)
	}
	if got := manager.Status(); got.Phase != PhaseReady || got.Blocking {
		t.Fatalf("an older host read undid ready: %+v", got)
	}
}
