package control

import (
	"context"
	"strings"
	"testing"
)

// The three phases, from what the control knows: the harness is up, the harness is gone with a reason,
// or nothing has answered yet. A console that has to assemble this from WorkerUp and WorkerError is a
// console that will disagree with itself.
func TestTheLifecycleSaysWhenAWorkspaceCanBeUsed(t *testing.T) {
	c := New(Options{Workspace: Workspace{Name: "w", Path: t.TempDir()}})
	if got := c.Lifecycle(); got.Phase != LifecycleStarting || got.Reason == "" {
		t.Errorf("a control that has not started its harness is starting, got %+v", got)
	}
	c.mu.Lock()
	c.workerError = "the harness process ended: exit status 1"
	c.mu.Unlock()
	if got := c.Lifecycle(); got.Phase != LifecycleFailed || !strings.Contains(got.Reason, "exit status 1") {
		t.Errorf("a harness that died is failed, with the reason, got %+v", got)
	}
	// A process that exists but has not answered is not ready: that is the window in which the
	// console offered a conversation and the write went to a harness that could not take it.
	c.mu.Lock()
	c.workerUp = true
	c.workerError = ""
	c.mu.Unlock()
	if got := c.Lifecycle(); got.Phase != LifecycleStarting {
		t.Errorf("a harness that only spawned is still starting, got %+v", got)
	}
	c.markWorkerReady()
	if got := c.Lifecycle(); got.Phase != LifecycleReady || got.Reason != "" {
		t.Errorf("a harness that answers is ready, got %+v", got)
	}
}

// And a conversation is not made before then: the harness is the thing that makes one, and it was not
// there — the console used to offer the button and then report "harness down".
func TestAConversationIsNotMadeBeforeTheWorkspaceIsReady(t *testing.T) {
	c := New(Options{Workspace: Workspace{Name: "w", Path: t.TempDir()}})
	err := c.Create(context.Background())
	if err == nil {
		t.Fatal("a conversation was created before the workspace was ready")
	}
	if !strings.Contains(err.Error(), "not ready yet") || !strings.Contains(err.Error(), "the harness is starting") {
		t.Errorf("the refusal should say what is missing, got %v", err)
	}
}
