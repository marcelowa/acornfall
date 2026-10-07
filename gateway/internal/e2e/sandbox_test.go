package e2e

import (
	"os"
	"testing"
)

// With sandboxes forced off, the product has to take its refusal path: no engine is installed
// or booted, and every tool says why it will not run. Auto-detecting the hypervisor instead
// made one command boot microVMs on this machine and refuse in CI, which is the divergence
// the switch exists to remove.
//
// The test skips when the switch is not set, because then the sandbox tier is meant to run:
// `make test` sets it, `make test-sandbox` does not.
func TestForcedNoSandboxRefusesInsteadOfFallingBack(t *testing.T) {
	if os.Getenv("ACORNFALL_NO_SANDBOX") == "" {
		t.Skip("ACORNFALL_NO_SANDBOX=1 is what this asserts; make test sets it")
	}
	t.Parallel()
	notSandbox(t)
	s := start(t)
	c := s.client()
	c.waitForConversation("general")

	got := c.state("general")
	if got.Sandbox.Tools {
		t.Errorf("tools must not be available when the sandbox tier is forced off, got %+v", got.Sandbox)
	}
	if got.Sandbox.Problem == "" {
		t.Error("the refusal must say why, or a client cannot explain a missing tool")
	}
}
