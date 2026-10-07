package e2e

import (
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

// A fresh install is usable without a setup step: there is a conversation to type into, and
// it is the root one.
func TestAFreshInstallHasARootConversation(t *testing.T) {
	t.Parallel()
	notSandbox(t)
	s := start(t)
	c := s.client()

	got := c.state("general")
	if len(got.Conversations) != 1 {
		t.Fatalf("a fresh install should have one conversation, got %d", len(got.Conversations))
	}
	if !got.Conversations[0].Root {
		t.Error("the conversation a fresh install creates should be the root one")
	}
	if got.Conversation == nil || got.Conversation.ID != got.Conversations[0].ID {
		t.Errorf("the state should name the conversation it lands on, got %+v", got.Conversation)
	}
	if got.Workspace.Name != "general" || len(got.Workspaces) != 1 {
		t.Errorf("a fresh install should have only the general workspace, got %+v", got.Workspaces)
	}
	if !got.WorkerUp {
		t.Errorf("the harness should be up, got workerError=%q", got.WorkerError)
	}
	if got.Harness != "pi-durable" {
		t.Errorf("the harness should describe itself, got %q", got.Harness)
	}
	// The client is told what the harness can do, because it decides what to offer.
	if got.Capabilities["sandbox"] == nil {
		t.Errorf("capabilities should include the sandbox kind, got %+v", got.Capabilities)
	}
	if got.Capabilities["steer"] != true {
		t.Errorf("this harness can be steered, got %+v", got.Capabilities)
	}
}

// A conversation is created, named, hidden, and brought back. Hiding is a tombstone: the
// storage is append-only, so the transcript has to survive it.
func TestConversationLifecycle(t *testing.T) {
	t.Parallel()
	notSandbox(t)
	s := start(t, withScript(scriptRule{Match: "remember this", Reply: "I will remember."}))
	c := s.client()

	created := c.create("general")
	if created.Title != "New conversation" {
		t.Errorf("a new conversation is unnamed, got %q", created.Title)
	}
	if created.Root {
		t.Error("a created conversation is not the root one")
	}

	c.prompt("general", created.ID, "remember this")
	before := c.waitForText("general", created.ID, "I will remember.")

	c.rename("general", created.ID, "Renamed by a test")
	renamed, found := c.conversationIn("general", created.ID)
	if !found || renamed.Title != "Renamed by a test" {
		t.Fatalf("rename did not take: %+v (found %v)", renamed, found)
	}

	c.hide("general", created.ID, true)
	hidden, found := c.conversationIn("general", created.ID)
	if !found {
		t.Fatal("a hidden conversation must still be listed, or it can never be restored")
	}
	if !hidden.Hidden {
		t.Error("the conversation should report itself hidden")
	}
	if hidden.Title != "Renamed by a test" {
		t.Errorf("hiding should not disturb the name, got %q", hidden.Title)
	}

	// Restoring it brings back the same conversation, with the transcript it had.
	c.hide("general", created.ID, false)
	restored, _ := c.conversationIn("general", created.ID)
	if restored.Hidden {
		t.Error("the conversation should be visible again")
	}
	after := c.view("general", created.ID)
	if !strings.Contains(after.all(), "remember this") || !strings.Contains(after.all(), "I will remember.") {
		t.Errorf("the transcript did not survive the tombstone:\n%s", after.all())
	}
	if len(before.Entries) != len(after.Entries) {
		t.Errorf("the transcript changed across hiding: %d entries then, %d now", len(before.Entries), len(after.Entries))
	}
}

// An unnamed conversation is named after its first user message, so the rail is readable
// without anyone naming anything.
func TestConversationTitleComesFromTheFirstMessage(t *testing.T) {
	t.Parallel()
	notSandbox(t)
	s := start(t, withScript(scriptRule{Match: "what is the capital", Reply: "Paris."}))
	c := s.client()

	created := c.create("general")
	c.prompt("general", created.ID, "what is the capital of France, and please be brief about it")
	c.waitForText("general", created.ID, "Paris.")

	// The name is derived by the harness and arrives with the next conversation listing, so
	// waiting for it is waiting for the run to be reflected, not for a fixed delay.
	titled := c.waitForTitle("general", created.ID, "what is the capital")
	if !strings.HasPrefix(titled.Title, "what is the capital") {
		t.Errorf("expected the title to come from the first message, got %q", titled.Title)
	}
	if len(titled.Title) > 80 {
		t.Errorf("the title should be truncated, got %d characters", len(titled.Title))
	}
}

// A fork branches before a user turn: the branch keeps the history that led to it, and does
// not keep the message it branched from. It is how "say that again, differently" works.
func TestForkBranchesBeforeATurn(t *testing.T) {
	t.Parallel()
	notSandbox(t)
	s := start(t, withScript(
		scriptRule{Match: "first question", Reply: "first answer"},
		scriptRule{Match: "second question", Reply: "second answer"},
	))
	c := s.client()

	created := c.create("general")
	c.prompt("general", created.ID, "first question")
	c.waitForText("general", created.ID, "first answer")
	c.prompt("general", created.ID, "second question")
	full := c.waitForText("general", created.ID, "second answer")

	// A branch point is the entry *before* a user turn: durable's fork sees everything up to
	// and including the id it is given, so branching before a message means passing the entry
	// that precedes it. This is what the client's Branch button passes.
	var at string
	var previous *entry
	for index := range full.Entries {
		e := full.Entries[index]
		if e.Kind == "pi.user" && strings.Contains(e.text(), "second question") && previous != nil {
			at = strconv.Itoa(previous.ID)
		}
		previous = &full.Entries[index]
	}
	if at == "" {
		t.Fatal("the second user message is not in the transcript")
	}

	child := c.fork("general", created.ID, at)
	if child.ID == created.ID {
		t.Fatal("fork should create a conversation, not return the same one")
	}
	if child.Root {
		t.Error("a fork is not the root conversation")
	}

	branch := c.view("general", child.ID)
	if strings.Contains(branch.all(), "second question") {
		t.Errorf("the branch should stop before the message it branched from:\n%s", branch.all())
	}
	if !strings.Contains(branch.all(), "first question") || !strings.Contains(branch.all(), "first answer") {
		t.Errorf("the branch should keep the history before it:\n%s", branch.all())
	}
	// The parent is untouched: forking is not moving.
	parent := c.view("general", created.ID)
	if !strings.Contains(parent.all(), "second answer") {
		t.Errorf("forking changed the conversation it forked from:\n%s", parent.all())
	}
}

// A prompt produces a transcript the client can read: the user's message, the prompt that
// was sent, the assistant's answer, and spend that is attributed to this conversation.
func TestPromptRoundTrip(t *testing.T) {
	t.Parallel()
	notSandbox(t)
	s := start(t, withScript(scriptRule{Match: "say hello", Reply: "Hello from the script."}))
	c := s.client()
	root := c.waitForConversation("general")

	c.prompt("general", root, "say hello")
	got := c.waitForText("general", root, "Hello from the script.")

	for _, want := range []string{"pi.user", "pi.system", "pi.assistant"} {
		if len(got.entriesOf(want)) == 0 {
			t.Errorf("the transcript should contain a %s entry, got %s", want, strings.Join(got.kinds(), ","))
		}
	}
	if sections := got.systemSections(); len(sections) == 0 {
		t.Error("the transcript should carry the prompt that was sent")
	}
	c.waitIdle("general", root, 30*time.Second)

	idle := conversationByID(t, c.conversations("general"), root)
	if idle.Running {
		t.Error("the conversation should be idle once the answer is in")
	}
	if idle.Tokens <= 0 {
		t.Errorf("the conversation should report what it spent, got %v tokens", idle.Tokens)
	}
	if idle.LastEntryID == "" {
		t.Error("the newest entry id is the client's unread cursor, so it has to be reported")
	}
	if idle.Model != "faux/faux-1" {
		t.Errorf("the conversation should report the model it ran, got %q", idle.Model)
	}
	spend := c.state("general")
	if spend.Agent.Provider != "faux" || spend.Agent.ModelID != "faux-1" {
		t.Errorf("the state should report the binding that will run, got %+v", spend.Agent)
	}
}

// A tool call runs for real, and both the call and its output are in the transcript: the
// point of the platform is that the model touches the workspace — inside its sandbox, which
// is why this test needs one.
func TestAToolCallRunsAndIsRecorded(t *testing.T) {
	t.Parallel()
	maybeSandbox(t)
	s := start(t, withScript(scriptRule{
		Match: "list the files",
		Tools: []scriptTool{{Name: "bash", Args: map[string]any{"command": "ls"}}},
		Reply: "Listed.",
	}))
	c := s.client()
	root := c.waitForConversation("general")
	if err := os.WriteFile(filepath.Join(s.General, "a-file-only-here.txt"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}

	c.prompt("general", root, "list the files")
	got := c.waitForText("general", root, "Listed.")

	transcript := got.all()
	if !strings.Contains(transcript, "a-file-only-here.txt") {
		t.Errorf("the tool result should contain what the command printed:\n%s", transcript)
	}
	if len(got.toolResults()) == 0 {
		t.Errorf("the transcript should record the tool result:\n%s", transcript)
	}
	sawCall := false
	for _, e := range got.Entries {
		if e.Kind == "pi.assistant" && strings.Contains(e.text(), "tool:bash") {
			sawCall = true
		}
	}
	if !sawCall {
		t.Errorf("the transcript should record the call:\n%s", transcript)
	}
	// A result that carries both the command's output and the harness's error block is worse
	// than either alone: the model reads the error and distrusts the output. This assertion
	// was missing while every streamed command was reported as "exec session ended without
	// exit event", which only the file name above could not catch.
	if result := got.lastToolResult(); strings.Contains(result, "[error]") {
		t.Errorf("a command that succeeded was reported with an error:\n%s", result)
	}
}

// A conversation can be given its own model and thinking level, and the level is clamped to
// what the model can do while the request is remembered. The scripted model only offers
// "off", so asking for more must land on "off" and say what was asked.
func conversationByID(t *testing.T, list []conversation, id string) conversation {
	t.Helper()
	for _, candidate := range list {
		if candidate.ID == id {
			return candidate
		}
	}
	t.Fatalf("conversation %s is not in the listing: %+v", id, list)
	return conversation{}
}

func TestThinkingIsClampedButTheRequestIsRemembered(t *testing.T) {
	t.Parallel()
	notSandbox(t)
	s := start(t, withScript(scriptRule{Match: "think hard", Reply: "Thought."}))
	c := s.client()
	root := c.waitForConversation("general")

	c.post(c.conversationPath("general", root)+"/agent", map[string]any{"thinkingLevel": "max"}, nil)

	got := c.state("general")
	if got.Conversation == nil {
		t.Fatal("no conversation in the state")
	}
	if got.Agent.ThinkingLevel != "off" {
		t.Errorf("a model that offers only off must run off, got %q", got.Agent.ThinkingLevel)
	}
	// Through the refreshed listing, not the state: what a conversation records is committed by
	// the harness, and the state is the cached view that a watching client is pushed.
	recorded := conversationByID(t, c.conversations("general"), root)
	if recorded.Thinking != "off" {
		t.Errorf("the conversation should record the level it runs, got %q", recorded.Thinking)
	}
	if recorded.Model != "faux/faux-1" {
		t.Errorf("the conversation should record the model it runs, got %q", recorded.Model)
	}

	// The request is kept, so switching to a model that can honour it restores the choice.
	c.prompt("general", root, "think hard")
	c.waitForText("general", root, "Thought.")
	after := c.state("general")
	if after.Agent.ThinkingLevel != "off" {
		t.Errorf("the applied level should still be off, got %q", after.Agent.ThinkingLevel)
	}
}

// Choosing something that cannot run is refused with a reason, not accepted and then
// silently replaced.
func TestUnusableChoicesAreRefused(t *testing.T) {
	t.Parallel()
	notSandbox(t)
	s := start(t)
	c := s.client()
	root := c.waitForConversation("general")
	path := c.conversationPath("general", root) + "/agent"

	status, body := c.postStatus(path, map[string]any{"provider": "anthropic", "modelId": "claude-sonnet-4"})
	if status == 200 {
		t.Errorf("a model with no credentials should be refused, got %d", status)
	}
	if !strings.Contains(body, "not available") {
		t.Errorf("the refusal should say why, got %q", body)
	}

	status, body = c.postStatus(path, map[string]any{"definition": "no-such-agent"})
	if status == 200 {
		t.Errorf("an unknown agent definition should be refused, got %d", status)
	}
	if !strings.Contains(body, "no agent definition") {
		t.Errorf("the refusal should name the missing definition, got %q", body)
	}

	// And the conversation is unchanged by either refusal.
	after := c.state("general")
	if after.Agent.ModelID != "faux-1" {
		t.Errorf("a refused change must not take effect, got %+v", after.Agent)
	}
}
