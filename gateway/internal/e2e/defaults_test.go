package e2e

import (
	"os"
	"path/filepath"
	"testing"
)

// A workspace's own default applies to the conversations that never chose, and the state says
// which layer it came from — "what runs" without "why" is a question the interface cannot
// answer.
func TestWorkspaceDefaultsApplyAndSayWhereTheyCameFrom(t *testing.T) {
	s := start(t, withScript(scriptRule{Match: "anything", Reply: "answered"}))
	c := s.client()

	// The scripted model offers only "off", which makes the clamping visible: the default is
	// what was asked for, and what runs is what the model can do.
	c.post("/api/workspaces/general/default-thinking", map[string]any{"level": "high"}, nil)
	got := c.state("general")
	if got.DefaultThinking != "high" {
		t.Errorf("the workspace default should be what was set, got %q", got.DefaultThinking)
	}
	if got.DefaultsOrigin["thinking"] != "workspace" {
		t.Errorf("it should be reported as this workspace's own, got %q", got.DefaultsOrigin["thinking"])
	}
	if got.Agent.ThinkingLevel != "off" {
		t.Errorf("the model offers only off, so that is what runs, got %q", got.Agent.ThinkingLevel)
	}
	if got.Agent.ThinkingRequested != "high" {
		t.Errorf("the level that was asked for should be kept, got %q", got.Agent.ThinkingRequested)
	}

	// Clearing it falls through rather than leaving nothing.
	c.post("/api/workspaces/general/default-thinking", map[string]any{"level": ""}, nil)
	cleared := c.state("general")
	if cleared.DefaultThinking != "" || cleared.DefaultsOrigin["thinking"] != "" {
		t.Errorf("a cleared default should have no origin, got %q / %q",
			cleared.DefaultThinking, cleared.DefaultsOrigin["thinking"])
	}
}

// An install default is the answer for every workspace that has not decided for itself, and
// it applies to running workspaces without a restart.
func TestInstallDefaultsApplyToEveryWorkspace(t *testing.T) {
	s := start(t)
	c := s.client()
	c.createWorkspace("second")

	c.post("/api/defaults/thinking", map[string]any{"level": "low"}, nil)
	for _, workspace := range []string{"general", "second"} {
		got := c.state(workspace)
		if got.DefaultThinking != "low" || got.DefaultsOrigin["thinking"] != "install" {
			t.Errorf("%s should follow the install default, got %q from %q",
				workspace, got.DefaultThinking, got.DefaultsOrigin["thinking"])
		}
	}

	// A workspace that decides for itself keeps it, and the other is unaffected.
	c.post("/api/workspaces/general/default-thinking", map[string]any{"level": "high"}, nil)
	if got := c.state("general"); got.DefaultsOrigin["thinking"] != "workspace" || got.DefaultThinking != "high" {
		t.Errorf("the workspace's own default should win, got %q from %q", got.DefaultThinking, got.DefaultsOrigin["thinking"])
	}
	if got := c.state("second"); got.DefaultsOrigin["thinking"] != "install" {
		t.Errorf("the other workspace should still follow the install, got %q", got.DefaultsOrigin["thinking"])
	}

	// And clearing the install default leaves no file behind: an empty layer is not a layer.
	c.post("/api/defaults/thinking", map[string]any{"level": ""}, nil)
	if _, err := os.Stat(filepath.Join(s.Home, "settings.json")); err == nil {
		t.Error("clearing the install defaults should leave no file")
	}
	if got := c.state("second"); got.DefaultsOrigin["thinking"] != "" {
		t.Errorf("with nothing set anywhere there is no origin, got %q", got.DefaultsOrigin["thinking"])
	}
}

// With nothing set anywhere, a model is still chosen deliberately rather than by whichever
// happens to be listed first, and the state calls it what it is: the last resort.
func TestTheLastResortRunsWhenNothingIsSet(t *testing.T) {
	s := start(t)
	c := s.client()

	got := c.state("general")
	if got.DefaultModel.Provider == "" || got.DefaultModel.ModelID == "" {
		t.Fatalf("an install with a provider should always have a model, got %+v", got.DefaultModel)
	}
	if got.DefaultsOrigin["model"] != "last-resort" {
		t.Errorf("nothing was chosen, so it came from the last resort, got %q", got.DefaultsOrigin["model"])
	}
	if got.Agent.ModelID != got.DefaultModel.ModelID {
		t.Errorf("a conversation that never chose should run the resolved default: %+v vs %+v",
			got.Agent, got.DefaultModel)
	}

	// The install's own model wins over the last resort, and says so.
	c.post("/api/defaults/model", map[string]any{"provider": got.DefaultModel.Provider, "modelId": got.DefaultModel.ModelID}, nil)
	after := c.state("general")
	if after.DefaultsOrigin["model"] != "install" {
		t.Errorf("an install default should be reported as one, got %q", after.DefaultsOrigin["model"])
	}
}
