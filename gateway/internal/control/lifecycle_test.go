package control

import (
	"context"
	"strings"
	"testing"

	"github.com/acornfall/acornfall/gateway/internal/protocol"
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

// Every action that needs the harness is refused by the control itself, not only by the
// console. The beta.45 backend let a prompt reach a workspace that was registered but still
// starting, and the person got "harness is not running" instead of the phase's sentence.
func TestEveryHarnessActionIsRefusedBeforeTheWorkspaceIsReady(t *testing.T) {
	c := New(Options{Workspace: Workspace{Name: "w", Path: t.TempDir()}})
	ctx := context.Background()
	cases := []struct {
		name string
		call func() error
	}{
		{"create", func() error { return c.Create(ctx) }},
		{"prompt", func() error { return c.Prompt(ctx, "1", "hello", protocol.WhenBusyFollowUp, nil) }},
		{"select", func() error { return c.Select(ctx, "1") }},
		{"rename", func() error { return c.Rename(ctx, "1", "name") }},
		{"hide", func() error { return c.Hide(ctx, "1", true) }},
		{"fork", func() error { return c.Fork(ctx, "1", "0") }},
		{"compact", func() error { return c.Compact(ctx, "1") }},
		{"compact preview", func() error { _, err := c.CompactPreview(ctx, "1"); return err }},
		{"abort", func() error { return c.Abort(ctx, "1") }},
		{"agent", func() error { return c.SetAgent(ctx, "1", AgentChange{}) }},
		{"commands", func() error { _, err := c.Commands(ctx); return err }},
		{"agents", func() error { _, err := c.Agents(ctx); return err }},
		{"usage", func() error { _, err := c.Usage(ctx); return err }},
		{"policy", func() error { _, err := c.Policy(ctx, "1"); return err }},
		{"worker call", func() error { _, err := c.WorkerCall(ctx, "messages", "1"); return err }},
		{"refresh conversations", func() error { return c.RefreshConversations(ctx) }},
		{"upload", func() error { _, err := c.UploadAttachment(ctx, "", "", "", 0); return err }},
		{"default model", func() error { return c.SetDefaultModel(ctx, "p", "m") }},
		{"default thinking", func() error { return c.SetDefaultThinking(ctx, "high") }},
		{"default agent", func() error { return c.SetDefaultAgent(ctx, "") }},
		{"reload", func() error { return c.Reload(ctx) }},
		{"refresh", func() error { return c.Refresh(ctx) }},
		{"login", func() error { _, err := c.Login(ctx, "p", "api_key"); return err }},
		{"logout", func() error { return c.Logout(ctx, "p") }},
		{"auth answer", func() error { return c.AnswerAuth(ctx, "a", "p", "", false) }},
		{"auth cancel", func() error { return c.CancelAuth(ctx, "a") }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := tc.call()
			if err == nil {
				t.Fatal("an action that needs the harness was allowed before ready")
			}
			if !strings.Contains(err.Error(), "not ready yet") {
				t.Errorf("the refusal should name the phase, got %v", err)
			}
		})
	}
}
