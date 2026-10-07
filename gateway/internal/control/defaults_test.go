package control

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/acornfall/acornfall/gateway/internal/protocol"
)

func binding(provider, modelID string) protocol.ModelBinding {
	return protocol.ModelBinding{Provider: provider, ModelID: modelID}
}

// A workspace with credentials offering two models, one agent definition, and the two layers
// under test.
func layered(t *testing.T, workspace, install Defaults, lastResort protocol.ModelBinding) *Control {
	t.Helper()
	control := New(Options{
		Workspace:    Workspace{Name: "w", Path: t.TempDir()},
		SettingsPath: filepath.Join(t.TempDir(), "settings.json"),
	})
	control.describe = protocol.Describe{Providers: []protocol.ProviderInfo{{
		ID:            "opencode-go",
		Authenticated: true,
		Models: []protocol.ModelInfo{
			{ID: "minimax-m3", ThinkingLevels: []string{"low", "high"}},
			{ID: "deepseek-v4.1-flash", ThinkingLevels: []string{"low", "high"}},
		},
	}}}
	// The worker ships `general` built in, so a catalog without it is not a catalog the
	// gateway will ever see.
	control.catalog = protocol.AgentsData{
		Agents: []protocol.AgentSummary{{Name: "general"}, {Name: "researcher"}},
	}
	control.defaultModel, control.defaultThinking, control.defaultAgent = workspace.Model, workspace.Thinking, workspace.Agent
	control.install = install
	control.lastResort = lastResort
	return control
}

// The chain is conversation → its definition → this workspace → the install → the last
// resort. This covers the half beneath a conversation, which is what a workspace with nothing
// set of its own depends on.
func TestDefaultsFallThroughLayers(t *testing.T) {
	deepseek := binding("opencode-go", "deepseek-v4.1-flash")
	minimax := binding("opencode-go", "minimax-m3")

	cases := []struct {
		name       string
		workspace  Defaults
		install    Defaults
		lastResort protocol.ModelBinding
		want       Defaults
		origin     DefaultOrigins
	}{
		{
			name:       "this workspace's own choice wins over the install's",
			workspace:  Defaults{Model: minimax, Thinking: "low", Agent: "researcher"},
			install:    Defaults{Model: deepseek, Thinking: "high"},
			lastResort: deepseek,
			want:       Defaults{Model: minimax, Thinking: "low", Agent: "researcher"},
			origin:     DefaultOrigins{Model: originWorkspace, Thinking: originWorkspace, Agent: originWorkspace},
		},
		{
			name:       "an install default applies where the workspace has none",
			install:    Defaults{Model: deepseek, Thinking: "high", Agent: "researcher"},
			lastResort: minimax,
			want:       Defaults{Model: deepseek, Thinking: "high", Agent: "researcher"},
			origin:     DefaultOrigins{Model: originInstall, Thinking: originInstall, Agent: originInstall},
		},
		{
			name:       "with neither, the last resort runs",
			lastResort: deepseek,
			want:       Defaults{Model: deepseek},
			origin:     DefaultOrigins{Model: originLastResort},
		},
		{
			name:       "the fields resolve separately: a workspace model with an install level",
			workspace:  Defaults{Model: minimax},
			install:    Defaults{Model: deepseek, Thinking: "high"},
			lastResort: deepseek,
			want:       Defaults{Model: minimax, Thinking: "high"},
			origin:     DefaultOrigins{Model: originWorkspace, Thinking: originInstall},
		},
		{
			// A provider that went away must not take the install default down with it, and
			// must not be erased either: it applies again when the credentials come back.
			name:       "a workspace model nobody offers falls through, it is not forgotten",
			workspace:  Defaults{Model: binding("gone", "old-model")},
			install:    Defaults{Model: deepseek},
			lastResort: minimax,
			want:       Defaults{Model: deepseek},
			origin:     DefaultOrigins{Model: originInstall},
		},
		{
			// Same for a definition file that was renamed or deleted.
			name:       "an agent definition that is gone falls through",
			workspace:  Defaults{Agent: "deleted-long-ago"},
			install:    Defaults{Agent: "researcher"},
			lastResort: deepseek,
			want:       Defaults{Model: deepseek, Agent: "researcher"},
			origin:     DefaultOrigins{Model: originLastResort, Agent: originInstall},
		},
		{
			name:       "an install agent that is gone leaves the layered defaults",
			install:    Defaults{Model: deepseek, Agent: "deleted-long-ago"},
			lastResort: minimax,
			want:       Defaults{Model: deepseek},
			origin:     DefaultOrigins{Model: originInstall},
		},
		{
			name: "with nothing connected there is no model, and no origin pretending otherwise",
			want: Defaults{},
		},
	}

	for _, test := range cases {
		t.Run(test.name, func(t *testing.T) {
			control := layered(t, test.workspace, test.install, test.lastResort)
			if test.lastResort == (protocol.ModelBinding{}) && test.want.Model == (protocol.ModelBinding{}) {
				// "Nothing connected": the layer is empty, so nothing resolves a model.
				control.describe = protocol.Describe{}
			}
			resolved, origin := control.effectiveDefaults()
			if resolved != test.want {
				t.Errorf("defaults:\n got %+v\nwant %+v", resolved, test.want)
			}
			if origin != test.origin {
				t.Errorf("origins:\n got %+v\nwant %+v", origin, test.origin)
			}
		})
	}
}

// Resolving a default must not turn it into this workspace's choice: a fallback written down
// outranks the layer it came from for good, so the install could never change it again.
func TestResolvedDefaultsAreNotPersistedAsThisWorkspace(t *testing.T) {
	control := layered(t, Defaults{}, Defaults{Model: binding("opencode-go", "deepseek-v4.1-flash")}, protocol.ModelBinding{})
	resolved, _ := control.effectiveDefaults()
	if resolved.Model.ModelID != "deepseek-v4.1-flash" {
		t.Fatalf("expected the install default to resolve, got %+v", resolved)
	}
	control.persist()

	payload, err := os.ReadFile(control.opts.SettingsPath)
	if err != nil {
		t.Fatal(err)
	}
	var written persistedSettings
	if err := json.Unmarshal(payload, &written); err != nil {
		t.Fatal(err)
	}
	if written.DefaultModel.Provider != "" || written.DefaultThinking != "" || written.DefaultAgent != "" {
		t.Errorf("the resolved default was written into the workspace's own layer: %s", payload)
	}
}

// With no layer choosing a model, the install still runs something deliberate rather than
// whatever the provider happens to list first.
func TestLastResortPrefersAnExplicitModel(t *testing.T) {
	control := layered(t, Defaults{}, Defaults{}, protocol.ModelBinding{})
	// Listed first, so choosing it by accident is possible.
	if control.describe.Providers[0].Models[0].ID != "minimax-m3" {
		t.Fatal("the fixture no longer lists the unpreferred model first")
	}
	binding, err := control.deriveLastResort(control.describe)
	if err != nil {
		t.Fatal(err)
	}
	if binding.ModelID != "deepseek-v4.1-flash" {
		t.Errorf("expected the preferred model, got %s/%s", binding.Provider, binding.ModelID)
	}

	// A provider that does not offer it still gets a model: the preference is a preference.
	control.describe.Providers[0].Models = []protocol.ModelInfo{{ID: "minimax-m3"}}
	binding, err = control.deriveLastResort(control.describe)
	if err != nil {
		t.Fatal(err)
	}
	if binding.ModelID != "minimax-m3" {
		t.Errorf("expected the only model offered, got %s/%s", binding.Provider, binding.ModelID)
	}

	// And --model beats both, because an operator's flag is a decision, not a guess.
	control.opts.Model = "opencode-go/space-bunny-free"
	binding, err = control.deriveLastResort(control.describe)
	if err != nil {
		t.Fatal(err)
	}
	if binding.ModelID != "space-bunny-free" {
		t.Errorf("--model was not honoured, got %s/%s", binding.Provider, binding.ModelID)
	}
}

// The interface shows what will run and where it came from, so a workspace with nothing set
// still reads as "these are the install's", not as "this workspace chose".
func TestInheritedDefaultsReportTheirOrigin(t *testing.T) {
	control := layered(t, Defaults{}, Defaults{Model: binding("opencode-go", "deepseek-v4.1-flash"), Thinking: "high"}, protocol.ModelBinding{})
	state := control.StateFor("any")
	if state.DefaultsOrigin.Model != originInstall || state.DefaultsOrigin.Thinking != originInstall {
		t.Errorf("expected install origins, got %+v", state.DefaultsOrigin)
	}
	if state.DefaultModel.ModelID != "deepseek-v4.1-flash" {
		t.Errorf("the state should report the default that runs, got %+v", state.DefaultModel)
	}
}
