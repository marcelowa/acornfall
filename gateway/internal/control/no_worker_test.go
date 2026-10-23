package control

import (
	"context"
	"strings"
	"testing"
)

// A control whose harness never started has no worker. The HTTP server used to call through
// the nil pointer: the console asked for its commands while a workspace was still starting, and
// the answer was a panic and a closed connection. Every command that needs the harness must
// answer with the sentence the page can show instead.
func TestACommandWithNoHarnessIsRefusedNotAPanic(t *testing.T) {
	c := New(Options{Workspace: Workspace{Name: "w", Path: t.TempDir()}})
	cases := []struct {
		name string
		call func() error
	}{
		{"commands", func() error { _, err := c.Commands(context.Background()); return err }},
		{"agents", func() error { _, err := c.Agents(context.Background()); return err }},
		{"usage", func() error { _, err := c.Usage(context.Background()); return err }},
		{"policy", func() error { _, err := c.Policy(context.Background(), "1"); return err }},
		{"worker call", func() error {
			_, err := c.WorkerCall(context.Background(), "messages", "1")
			return err
		}},
		{"abort", func() error { return c.Abort(context.Background(), "1") }},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			err := tc.call()
			if err == nil {
				t.Fatal("a command with no harness must be refused")
			}
			if !strings.Contains(err.Error(), "harness is not running") {
				t.Errorf("the refusal should say what is missing, got %v", err)
			}
		})
	}
}
