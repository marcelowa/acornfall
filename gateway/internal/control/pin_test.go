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

// A definition that no longer exists is not pinned by name: it would fail every open, and the
// interface has to show a stale default rather than a broken conversation.
func TestAStaleDefaultAgentIsNotPinned(t *testing.T) {
	deepseek := binding("opencode-go", "deepseek-v4.1-flash")
	control := layered(t, Defaults{Model: deepseek, Thinking: "high", Agent: "gone"}, Defaults{}, deepseek)
	control.conversations = []protocol.ConversationInfo{{ID: "9"}}

	control.pinMissing(control.conversations)

	if got := control.bindings["9"]; got.Definition != "" {
		t.Fatalf("a definition that does not exist must not be pinned: %+v", got)
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
