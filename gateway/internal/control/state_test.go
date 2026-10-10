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
		{ID: "stuck", Running: true, UpdatedAt: now - 60*60*1000},
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

// A settlement ends the prompt grace: the run is over because the worker said so, and the
// busy sign should come down with the answer. Before, the grace ran its ten seconds no
// matter what, so a fast run left the thinking dots up after the answer arrived — the flag
// visibly lagging the transcript. A prompt newer than the settlement starts a new grace,
// which is what a queued follow-up is, and a record that is still live outranks both.
func TestASettlementEndsThePromptGrace(t *testing.T) {
	now := time.Now().UnixMilli()
	control := New(Options{Workspace: Workspace{Name: "w", Path: t.TempDir()}})
	control.conversations = []protocol.ConversationInfo{
		{ID: "settled", Running: false},
		{ID: "queued", Running: false},
		{ID: "overtaken", Running: true, UpdatedAt: now - 60_000},
	}
	control.promptedAt["settled"] = now - 2_000
	control.settledAt["settled"] = now - 1_000
	control.settledAt["queued"] = now - 3_000
	control.promptedAt["queued"] = now - 2_000
	control.promptedAt["overtaken"] = now - 2_000
	control.settledAt["overtaken"] = now - 1_000

	state := control.State()
	byID := map[string]Conversation{}
	for _, conversation := range state.Conversations {
		byID[conversation.ID] = conversation
	}
	if byID["settled"].Running {
		t.Error("a settled run is idle even inside the prompt grace")
	}
	if !byID["queued"].Running {
		t.Error("a prompt after the settlement starts a new grace")
	}
	if !byID["overtaken"].Running {
		t.Error("a record that is still live outranks the settlement")
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

// The signature is what decides whether attached clients are told the state moved, so it has
// to follow the rule the state publishes — the gated busy flag — and not the worker's raw
// record. Two inputs move that flag with nothing else changing: the prompt grace expiring,
// and a stuck record aging past the freshness window. A signature that read the raw record
// would stay quiet through both, and a client that read the flag in between would keep a busy
// sign that nothing would ever take down.
func TestTheSignatureFollowsTheBusyRule(t *testing.T) {
	now := time.Now().UnixMilli()
	cases := []struct {
		name  string
		first protocol.ConversationInfo
		last  protocol.ConversationInfo
		// Prompt stamps in Unix ms; zero means this case moves the record instead.
		firstStamp int64
		lastStamp  int64
	}{
		{
			name:       "the prompt grace expiring",
			first:      protocol.ConversationInfo{ID: "1"},
			last:       protocol.ConversationInfo{ID: "1"},
			firstStamp: now - 9_000,
			lastStamp:  now - 11_000,
		},
		{
			name:  "a record aging past the freshness window",
			first: protocol.ConversationInfo{ID: "1", Running: true, UpdatedAt: now - 29*60*1000},
			last:  protocol.ConversationInfo{ID: "1", Running: true, UpdatedAt: now - 31*60*1000},
		},
	}
	for _, testCase := range cases {
		t.Run(testCase.name, func(t *testing.T) {
			control := New(Options{Workspace: Workspace{Name: "w", Path: t.TempDir()}})
			control.conversations = []protocol.ConversationInfo{testCase.first}
			if testCase.firstStamp != 0 {
				control.promptedAt["1"] = testCase.firstStamp
			}
			before := control.conversationSignature()
			control.conversations = []protocol.ConversationInfo{testCase.last}
			if testCase.lastStamp != 0 {
				control.promptedAt["1"] = testCase.lastStamp
			}
			if after := control.conversationSignature(); after == before {
				t.Error("a busy flag that moved with time is still a change to announce")
			}
		})
	}
}

// A state change wakes attached clients through their own signal, never through the frame
// channel: that channel drops what it cannot hold, and a client that never hears the state
// moved keeps showing the state it read before — a busy sign outliving its run. The signal
// also stays out of the frames a client has not read yet, so a slow write loses neither.
func TestAStateChangeWakesSubscribersWithoutTouchingTheirFrames(t *testing.T) {
	control := New(Options{Workspace: Workspace{Name: "w", Path: t.TempDir()}})
	frames := make(chan protocol.Frame, 1)
	stale := make(chan struct{}, 1)
	control.subscribers[1] = frames
	control.staleSignals[1] = stale

	control.publish(protocol.Frame{Type: "state"})
	// A second change while the first signal is still waiting is not a second wakeup: the
	// waiting signal already says the state moved.
	control.publish(protocol.Frame{Type: "state"})

	wakes := 0
	for {
		select {
		case <-stale:
			wakes++
			continue
		default:
		}
		break
	}
	if wakes != 1 {
		t.Errorf("a waiting signal already says the state moved, got %d wakeups", wakes)
	}
	select {
	case frame := <-frames:
		t.Fatalf("a state change is not a frame, got %q", frame.Type)
	default:
	}
}

// A state that moved with time alone is still news: the same record, the same entry, only the
// prompt grace expired. The poll asks whether the state differs from what clients were last
// told, because nothing refreshes when only time passes — comparing two signatures taken
// milliseconds apart would never see it, and the busy sign would stay up.
func TestATimeOnlyChangeIsAnnounced(t *testing.T) {
	now := time.Now().UnixMilli()
	control := New(Options{Workspace: Workspace{Name: "w", Path: t.TempDir()}})
	control.conversations = []protocol.ConversationInfo{{ID: "1"}}
	control.promptedAt["1"] = now - 9_000
	control.notifyState()

	control.promptedAt["1"] = now - 11_000
	if !control.stateStale() {
		t.Error("the grace expiring is a change attached clients have to hear about")
	}
	control.notifyState()
	if control.stateStale() {
		t.Error("a state that was just announced is not news again")
	}
}
