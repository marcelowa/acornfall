package control

import (
	"sync/atomic"
	"testing"
)

// Building a state must not read the registry while holding a control's own lock.
//
// The eviction sweep takes the registry lock and then reads each control, so reading the
// registry from inside a control's lock makes two orders out of one pair of locks. A
// pending writer on either side then closes the cycle, and one state build, one sweep, and
// one frame arriving together hang every request that touches both — which is every
// request. It is not a theoretical hazard: this happened, and the interface sat on
// "connecting" until the process was killed.
//
// Checked instead of timed. A deadlock is not something a test can assert on directly,
// only wait for, and waiting gets the answer wrong in both directions: a lock held briefly
// looks fine, and a lock starved by a busy writer looks fatal. Here the registry callback
// asks the control's lock whether it is free, which is true exactly when the registry is
// being read from outside it. No timing, no goroutines, no flakes.
func TestStateDoesNotTakeTheRegistryLockInsideItsOwn(t *testing.T) {
	workspaces := NewWorkspaces(WorkspacesOptions{Home: t.TempDir()})
	if err := workspaces.loadRegistry(); err != nil {
		t.Fatal(err)
	}
	workspace := Workspace{Name: "checked", Path: t.TempDir()}
	workspace.Title = workspace.Name
	workspaces.registry[workspace.Name] = workspace

	var reads, inverted atomic.Int64
	var subject *Control
	subject = New(Options{
		Workspace: workspace,
		Registry: func() []Workspace {
			reads.Add(1)
			// Reading the registry is only safe while this lock is not held. TryLock says
			// whether anyone holds it, and nothing else in this test does.
			if subject.mu.TryLock() {
				subject.mu.Unlock()
				return workspaces.List()
			}
			inverted.Add(1)
			return nil
		},
	})
	workspaces.controls[workspace.Name] = subject

	// Both entry points: State() delegates today, and would stop being covered if it
	// stopped delegating.
	subject.StateFor("")
	subject.State()

	if reads.Load() == 0 {
		t.Fatal("the state never read the registry, so this test checked nothing")
	}
	if inverted.Load() > 0 {
		t.Fatalf(
			"the registry was read %d time(s) while the control's lock was held: the eviction sweep takes those two locks in the opposite order, which deadlocks both",
			inverted.Load(),
		)
	}
}
