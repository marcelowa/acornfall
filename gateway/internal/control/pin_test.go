package control

import (
	"testing"

	"github.com/acornfall/acornfall/gateway/internal/protocol"
)

// A conversation pins what it will run when it is created: the resolved defaults, so a
// default changed later cannot move a conversation that already started (ADR 0017).
func TestAConversationPinsWhatResolves(t *testing.T) {
	deepseek := binding("opencode-go", "deepseek-v4.1-flash")
	control := layered(t,
		Defaults{Model: deepseek, Thinking: "high"},
		Defaults{},
		binding("opencode-go", "minimax-m3"),
	)
	control.conversations = []protocol.ConversationInfo{{ID: "7"}}

	if !control.pinOne("7") {
		t.Fatal("a conversation with a provider to resolve should be pinned")
	}
	got := control.bindings["7"]
	if got.Provider != "opencode-go" || got.ModelID != "deepseek-v4.1-flash" || got.ThinkingLevel != "high" {
		t.Fatalf("pinned %+v, want this workspace's model and level", got)
	}
}

// The migration pins only the conversations that never chose: a conversation with a binding
// made a choice, and a subagent is configured by whatever created it.
func TestMigrationPinsOnlyWhatNeverChose(t *testing.T) {
	deepseek := binding("opencode-go", "deepseek-v4.1-flash")
	control := layered(t, Defaults{Model: deepseek, Thinking: "high"}, Defaults{}, deepseek)
	control.bindings["2"] = protocol.ModelBinding{
		Provider:      "opencode-go",
		ModelID:       "minimax-m3",
		ThinkingLevel: "low",
	}
	control.conversations = []protocol.ConversationInfo{
		{ID: "1"},
		{ID: "2"},
		{ID: "3", Parent: "1"},
	}

	control.pinMissing(control.conversations)

	if got := control.bindings["1"]; got.ModelID != "deepseek-v4.1-flash" {
		t.Fatalf("conversation 1 never chose and should have been pinned, got %+v", got)
	}
	if got := control.bindings["2"]; got.ModelID != "minimax-m3" || got.ThinkingLevel != "low" {
		t.Fatalf("conversation 2 chose for itself and must not move: %+v", got)
	}
	if _, pinned := control.bindings["3"]; pinned {
		t.Fatalf("a subagent is configured by its creator: %+v", control.bindings["3"])
	}
}

// A definition that no longer exists is not pinned by name: it would fail every open. The
// conversation falls through to the general agent, which is what it will actually run.
func TestAStaleDefaultAgentIsNotPinned(t *testing.T) {
	deepseek := binding("opencode-go", "deepseek-v4.1-flash")
	control := layered(t, Defaults{Model: deepseek, Thinking: "high", Agent: "gone"}, Defaults{}, deepseek)
	control.conversations = []protocol.ConversationInfo{{ID: "9"}}

	control.pinMissing(control.conversations)

	if got := control.bindings["9"]; got.Definition != GeneralAgent {
		t.Fatalf("a stale default agent must not be pinned; the general one should be: %+v", got)
	}
}

// An empty catalog means the worker has not described itself yet, not that no
// definition exists: pinning must still name the agent rather than leave the
// conversation unnamed until the catalog arrives.
func TestPinningNamesTheAgentBeforeTheCatalogArrives(t *testing.T) {
	deepseek := binding("opencode-go", "deepseek-v4.1-flash")
	control := layered(t, Defaults{Model: deepseek, Thinking: "high"}, Defaults{}, deepseek)
	control.catalog = protocol.AgentsData{}
	control.conversations = []protocol.ConversationInfo{{ID: "8"}}

	if !control.hasAgentDefinition(GeneralAgent) {
		t.Fatal("an empty catalog is an undescribed worker, not a missing definition")
	}
	if !control.pinOne("8") {
		t.Fatal("a conversation with a provider to resolve should be pinned")
	}
	if got := control.bindings["8"]; got.Definition != GeneralAgent {
		t.Fatalf("pinned %+v, want the general agent named", got)
	}
}

// A default agent that does exist is pinned with the rest.
func TestADefaultAgentIsPinned(t *testing.T) {
	deepseek := binding("opencode-go", "deepseek-v4.1-flash")
	control := layered(t, Defaults{Model: deepseek, Thinking: "high", Agent: "researcher"}, Defaults{}, deepseek)
	control.conversations = []protocol.ConversationInfo{{ID: "9"}}

	control.pinMissing(control.conversations)

	if got := control.bindings["9"]; got.Definition != "researcher" {
		t.Fatalf("the default agent should be pinned by name: %+v", got)
	}
}

// Nothing to resolve means nothing to pin: a workspace with no provider keeps inheriting
// until there is something to inherit.
func TestNothingResolvedIsNotPinned(t *testing.T) {
	control := layered(t, Defaults{}, Defaults{}, protocol.ModelBinding{})
	control.conversations = []protocol.ConversationInfo{{ID: "4"}}

	if control.pinOne("4") {
		t.Fatalf("pinned %+v with no provider anywhere", control.bindings["4"])
	}
}

// Nothing configured an agent, so the conversation runs the general one — and it says so,
// because a name is what the interface shows.
func TestTheGeneralAgentIsPinnedWhenNothingElseIs(t *testing.T) {
	deepseek := binding("opencode-go", "deepseek-v4.1-flash")
	control := layered(t, Defaults{Model: deepseek, Thinking: "high"}, Defaults{}, deepseek)
	control.conversations = []protocol.ConversationInfo{{ID: "4"}}

	if !control.pinOne("4") {
		t.Fatal("a conversation with a provider to resolve should be pinned")
	}
	if got := control.bindings["4"]; got.Definition != GeneralAgent {
		t.Fatalf("pinned %+v, want the general agent named", got)
	}
}

// A configured default agent still wins: the general one is what is left when nothing chose.
func TestAConfiguredAgentBeatsTheGeneralOne(t *testing.T) {
	deepseek := binding("opencode-go", "deepseek-v4.1-flash")
	control := layered(t, Defaults{Model: deepseek, Agent: "researcher"}, Defaults{}, deepseek)
	control.conversations = []protocol.ConversationInfo{{ID: "4"}}

	control.pinOne("4")

	if got := control.bindings["4"]; got.Definition != "researcher" {
		t.Fatalf("pinned %+v, want this workspace's agent", got)
	}
}

// The conversations that were pinned before the general agent existed have a model and no
// definition. They get the name once, and a conversation that clears its definition later is
// asking to follow the default, so it must not be given the name back.
func TestTheGeneralAgentIsNamedOnceForConversationsThatPredateIt(t *testing.T) {
	deepseek := binding("opencode-go", "deepseek-v4.1-flash")
	control := layered(t, Defaults{Model: deepseek}, Defaults{}, deepseek)
	control.bindings["5"] = protocol.ModelBinding{
		Provider:      "opencode-go",
		ModelID:       "deepseek-v4.1-flash",
		ThinkingLevel: "high",
	}
	control.bindings["6"] = protocol.ModelBinding{
		Provider:   "opencode-go",
		ModelID:    "minimax-m3",
		Definition: "researcher",
	}
	control.conversations = []protocol.ConversationInfo{{ID: "5"}, {ID: "6"}}

	control.pinMissing(control.conversations)

	if got := control.bindings["5"]; got.Definition != GeneralAgent {
		t.Fatalf("a conversation that never named an agent should have been given one: %+v", got)
	}
	if got := control.bindings["6"]; got.Definition != "researcher" {
		t.Fatalf("a conversation that chose an agent must not move: %+v", got)
	}
	if !control.generalPinned {
		t.Fatal("the naming should be recorded, so it happens once")
	}

	// Cleared afterwards, which is a request to follow the default rather than to be named.
	cleared := control.bindings["5"]
	cleared.Definition = ""
	control.bindings["5"] = cleared
	control.pinMissing(control.conversations)
	if got := control.bindings["5"]; got.Definition != "" {
		t.Fatalf("clearing the definition should stick: %+v", got)
	}
}
