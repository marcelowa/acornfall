package control

import (
	"testing"

	"github.com/acornfall/acornfall/gateway/internal/protocol"
)

// StateFor must describe the conversation it was asked about, not the one the worker
// happens to be attached to.
//
// They differ exactly when it matters: a client asks about a conversation before attaching
// to it, which is every switch, and the answer is what the client then follows. It used to
// answer with the attached conversation, so switching to another conversation returned the
// one you were looking at, and a client that trusts the answer (the tab names what it is
// showing in the URL, and reads it back from here) undid the switch it had just made.
func TestStateForDescribesTheConversationItWasAskedFor(t *testing.T) {
	control := New(Options{Workspace: Workspace{Name: "w", Path: t.TempDir()}})
	control.active = "attached"
	control.conversations = []protocol.ConversationInfo{
		{ID: "attached", Title: "the one open", Tokens: 10},
		{ID: "asked", Title: "the one asked about", Tokens: 4242},
	}
	// An explicit binding on the conversation asked about, and none on the attached one:
	// which of the two the answer describes is then visible in the inherited flags too.
	control.bindings["asked"] = protocol.ModelBinding{Provider: "p", ModelID: "m"}

	asked := control.StateFor("asked")
	if asked.Conversation == nil {
		t.Fatal("no conversation in the state")
	}
	if asked.Conversation.ID != "asked" {
		t.Errorf("asked about %q, described %q", "asked", asked.Conversation.ID)
	}
	if asked.Conversation.Tokens != 4242 {
		t.Errorf("asked about a conversation with 4242 tokens, described one with %v", asked.Conversation.Tokens)
	}
	if asked.Inherited.Model {
		t.Error("the asked-about conversation has an explicit model, so it does not inherit one")
	}

	// And with nothing named, it is the attached one, which is what "the" conversation means.
	open := control.State()
	if open.Conversation == nil || open.Conversation.ID != "attached" {
		t.Fatalf("with no conversation named, the state should describe the attached one, got %+v", open.Conversation)
	}
	if !open.Inherited.Model {
		t.Error("the attached conversation has no explicit model, so it inherits one")
	}
}
