package control

import (
	"testing"

	"github.com/acornfall/acornfall/gateway/internal/protocol"
	"time"
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

// The listing carries last activity, so the rail can group conversations by date. A
// conversation that never moved carries none, which the wire omits rather than claiming
// an activity that never happened: the rail renders it flat, above the groups.
// Busy is one rule: a fresh record, or a prompt the record has not caught up to. A
// record with ancient activity is a dead run's residue, and a conversation that never
// moved is not busy no matter what the worker once claimed.
func TestRunningMeansLiveOrJustPrompted(t *testing.T) {
	now := time.Now().UnixMilli()
	control := New(Options{Workspace: Workspace{Name: "w", Path: t.TempDir()}})
	control.conversations = []protocol.ConversationInfo{
		{ID: "live", Running: true, UpdatedAt: now - 60_000},
		{ID: "stuck", Running: true, UpdatedAt: now - 60*60_1000},
		{ID: "fresh", Running: true},
		{ID: "prompted", Running: false},
	}
	control.promptedAt["prompted"] = now

	state := control.State()
	byID := map[string]Conversation{}
	for _, conversation := range state.Conversations {
		byID[conversation.ID] = conversation
	}
	if !byID["live"].Running {
		t.Error("a run with recent activity is busy")
	}
	if byID["stuck"].Running {
		t.Error("an hour-old record with no new prompt is a residue, not a run")
	}
	if byID["fresh"].Running {
		t.Error("a record with no activity at all is not a run")
	}
	if !byID["prompted"].Running {
		t.Error("an accepted prompt counts before the record exists")
	}
}

func TestConversationsCarryLastActivity(t *testing.T) {
	control := New(Options{Workspace: Workspace{Name: "w", Path: t.TempDir()}})
	control.conversations = []protocol.ConversationInfo{
		{ID: "moved", UpdatedAt: 1767139200000},
		{ID: "fresh"},
	}

	state := control.State()
	if len(state.Conversations) != 2 {
		t.Fatalf("expected two conversations, got %d", len(state.Conversations))
	}
	if state.Conversations[0].UpdatedAt != 1767139200000 {
		t.Errorf("the listing should carry last activity, got %d", state.Conversations[0].UpdatedAt)
	}
	if state.Conversations[1].UpdatedAt != 0 {
		t.Errorf("a conversation that never moved has no activity to report, got %d", state.Conversations[1].UpdatedAt)
	}
}
