package control

import (
	"strings"
	"testing"
)

// The worker is told why it has no sandbox, so the refusal a person reads carries the reason. On its own the
// sentence says only that tools are off, and the reason — a folder outside the machine's share root, an engine
// that is missing — stayed in a log on another machine.
func TestTheWorkerIsToldWhyItHasNoSandbox(t *testing.T) {
	c := New(Options{Workspace: Workspace{Name: "dev", Path: "/root/acornfall/workspaces/dev"}})
	problem := "/acornfall/workspaces/dev is outside the share root /root/acornfall, so the machine's VM cannot see it"
	if got := c.sandboxArgs(SandboxState{Problem: problem}); len(got) != 2 || got[0] != "--sandbox-problem" || got[1] != problem {
		t.Errorf("a workspace with no sandbox and a reason: %q", got)
	}
	// Nothing to say is not a sentence: a worker given an empty reason prints the plain refusal.
	if got := c.sandboxArgs(SandboxState{}); len(got) != 0 {
		t.Errorf("no sandbox and no reason: %q", got)
	}
	// A sandbox that was made is named, with the engine that owns it.
	got := strings.Join(c.sandboxArgs(SandboxState{Tools: true, Engine: "lxc"}), " ")
	if !strings.HasPrefix(got, "--sandbox acornfall-dev-") || !strings.HasSuffix(got, "--sandbox-engine lxc") {
		t.Errorf("a workspace with a sandbox: %q", got)
	}
}
