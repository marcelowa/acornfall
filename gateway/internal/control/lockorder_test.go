package control

import (
	"runtime"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/acornfall/acornfall/gateway/internal/protocol"
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

// Building a state must not take the control's read lock a second time.
//
// StateFor renders every conversation's row while holding its snapshot read lock, and the
// busy rule reads the prompt stamps for each row. Go's RWMutex puts a read lock that arrives
// after a queued writer behind that writer, so the second acquisition waits for a writer that
// is waiting for the first — held by this same goroutine — and every request behind it waits
// too. The production shape was one state request and one event-stream subscribe; the control
// lock wedged, the eviction sweep then held the registry lock while waiting on the control,
// and the interface sat on "harness down" until the process was killed.
//
// Checked without waiting on a deadlock: a writer is parked on the lock for the whole inner
// call, which is exactly what a queued writer looks like, and the build must still finish.
func TestStateBuildDoesNotTakeItsOwnReadLockAgain(t *testing.T) {
	subject := New(Options{})
	infos := []protocol.ConversationInfo{{ID: "one", Running: true, UpdatedAt: time.Now().UnixMilli()}}

	held := make(chan struct{})
	proceed := make(chan struct{})
	built := make(chan struct{})
	go func() {
		// The snapshot read lock, taken first, as StateFor takes it before rendering rows.
		subject.mu.RLock()
		close(held)
		<-proceed
		_ = subject.toConversations(infos)
		subject.mu.RUnlock()
		close(built)
	}()
	<-held

	// A writer arrives while the snapshot is held.
	var wrote atomic.Bool
	writerDone := make(chan struct{})
	go func() {
		subject.mu.Lock()
		wrote.Store(true)
		subject.mu.Unlock()
		close(writerDone)
	}()

	// Wait until it is queued: TryRLock fails exactly while a writer is pending or holding.
	deadline := time.Now().Add(5 * time.Second)
	for queuedWriter(&subject.mu) == false {
		if time.Now().After(deadline) {
			t.Fatal("the writer never queued on the control lock, so this test checked nothing")
		}
		runtime.Gosched()
	}
	close(proceed)

	select {
	case <-built:
	case <-time.After(5 * time.Second):
		t.Fatal("building conversation rows waited on a read lock the build already holds: a queued writer deadlocks the control")
	}
	select {
	case <-writerDone:
		if !wrote.Load() {
			t.Fatal("the queued writer never entered its critical section")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("the queued writer never followed the build")
	}
}

// queuedWriter reports whether a writer is pending or holding the lock, which is the state
// that makes a fresh read lock wait. A successful TryRLock is released at once: it is a
// question, not an acquisition.
func queuedWriter(mu *sync.RWMutex) bool {
	if mu.TryRLock() {
		mu.RUnlock()
		return false
	}
	return true
}
