package e2e

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"io"
	"mime/multipart"
	"net/http"
	"net/textproto"
	"os"
	"path/filepath"
	"regexp"
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
	if created.UpdatedAt != 0 {
		t.Errorf("a conversation that has not moved has no activity to report, got %d", created.UpdatedAt)
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

// Selecting lands even with no provider: "no authenticated provider" is a state, not a
// failure, and the friendly error arrives at send-time, not click-time.
func TestSelectingLandsWithNoProvider(t *testing.T) {
	t.Parallel()
	notSandbox(t)
	s := start(t, withoutDevProvider())
	c := s.client()

	// The listing is refreshed before answering, so the root is here even though no state
	// was ever announced for it.
	listed := c.conversations("general")
	if len(listed) != 1 {
		t.Fatalf("a fresh install should have one conversation, got %d", len(listed))
	}
	status, body := c.postStatus(c.conversationPath("general", listed[0].ID)+"/select", nil)
	if status != 200 {
		t.Fatalf("selecting with no provider should land, got %d: %s", status, body)
	}

	status, body = c.postStatus(c.conversationPath("general", listed[0].ID)+"/messages", map[string]any{"text": "hello"})
	if status == 200 {
		t.Error("sending with no provider should be refused")
	}
	if !strings.Contains(body, "connect a provider") {
		t.Errorf("the refusal should say a provider is needed, got %q", body)
	}
}

// An unnamed conversation is named after its first user message, so the rail is readable
// without anyone naming anything.
func TestConversationTitleComesFromTheFirstMessage(t *testing.T) {
	t.Parallel()
	notSandbox(t)
	s := start(t, withScript(
		scriptRule{Match: "what is the capital", Reply: "Paris."},
		scriptRule{Match: "in detail", Reply: "Paris, in detail."},
	))
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

	// A later message must not rename the row: the name froze on the first prompt.
	c.prompt("general", created.ID, "and now in detail")
	c.waitForText("general", created.ID, "Paris, in detail.")
	still := c.waitForTitle("general", created.ID, "what is the capital")
	if still.Title != titled.Title {
		t.Errorf("the title moved from %q to %q", titled.Title, still.Title)
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

// A manual compaction is accepted and leaves a short transcript alone: the wire path is
// ours, the summary is the harness's, and on a talk this short it has nothing worth
// summarizing, so no notice lands.
func TestCompactKeepsAShortTranscript(t *testing.T) {
	t.Parallel()
	notSandbox(t)
	s := start(t, withScript(scriptRule{Match: "remember this", Reply: "I will remember."}))
	c := s.client()

	created := c.create("general")
	c.prompt("general", created.ID, "remember this")
	before := c.waitForText("general", created.ID, "I will remember.")

	c.compact("general", created.ID)
	after := c.view("general", created.ID)
	if len(before.Entries) != len(after.Entries) {
		t.Errorf("compacting a short talk should change nothing: %d entries then, %d now", len(before.Entries), len(after.Entries))
	}
	if !strings.Contains(after.all(), "remember this") || !strings.Contains(after.all(), "I will remember.") {
		t.Errorf("the transcript did not survive compaction:\n%s", after.all())
	}
}

// A compaction preview counts the talk it would fold: two user turns here, and more
// entries than turns, since a turn is messages plus answers plus tool calls.
func TestCompactPreviewCountsTheTalk(t *testing.T) {
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
	c.waitForText("general", created.ID, "second answer")

	preview := c.compactPreview("general", created.ID)
	if preview["turns"] != 2.0 {
		t.Errorf("two user turns should preview as two, got %v", preview["turns"])
	}
	entries, ok := preview["entries"].(float64)
	if !ok || entries < 4 {
		t.Errorf("two turns hold at least four entries, got %v", preview["entries"])
	}
}

// A builtin is an action, not a turn: /clear resets the context, the transcript keeps
// the mark, and no model turn runs in between.
func TestSlashClearResetsTheContext(t *testing.T) {
	t.Parallel()
	notSandbox(t)
	s := start(t, withScript(scriptRule{Match: "remember this", Reply: "I will remember."}))
	c := s.client()

	created := c.create("general")
	c.prompt("general", created.ID, "remember this")
	c.waitForText("general", created.ID, "I will remember.")

	c.prompt("general", created.ID, "/clear")
	c.waitForText("general", created.ID, "/clear")
	c.waitView("general", created.ID, func(v view) bool {
		for _, kind := range v.kinds() {
			if kind == "pi.reset" {
				return true
			}
		}
		return false
	}, 2*time.Minute)
}

// The same path runs a compaction: /compact through the composer is accepted on a
// short talk, records itself, and says there was nothing to fold.
func TestSlashCompactIsAccepted(t *testing.T) {
	t.Parallel()
	notSandbox(t)
	s := start(t, withScript(scriptRule{Match: "remember this", Reply: "I will remember."}))
	c := s.client()

	created := c.create("general")
	c.prompt("general", created.ID, "remember this")
	before := c.waitForText("general", created.ID, "I will remember.")

	c.prompt("general", created.ID, "/compact")
	after := c.waitForText("general", created.ID, "Nothing to compact")
	if len(after.Entries) != len(before.Entries)+2 {
		t.Errorf("/compact on a short talk should record itself and say so: %d entries then, %d now", len(before.Entries), len(after.Entries))
	}
}

// A real fold reports itself: /compact on a long talk leaves a note saying how
// much folded, in entries and turns, and the summary card lands with it. The
// bulk comes from user texts, so no sandbox is needed and nothing streams it.
func TestSlashCompactReportsTheFold(t *testing.T) {
	t.Parallel()
	notSandbox(t)
	s := start(t, withScript(scriptRule{Match: "fill the context", Reply: "filled"}))
	c := s.client()

	created := c.create("general")
	bulk := strings.Repeat("abcdefghij ", 2500)
	for i := 0; i < 4; i++ {
		c.prompt("general", created.ID, "fill the context "+bulk)
		// Count replies, not text: every reply says the same word, so waiting
		// for the word matches the last turn's leftover and fires the next
		// prompt early — and a /compact sent mid-turn folds a short prefix.
		c.waitView("general", created.ID, func(v view) bool {
			return len(v.entriesOf("pi.assistant")) == i+1
		}, 2*time.Minute)
	}

	c.prompt("general", created.ID, "/compact")
	after := c.waitForText("general", created.ID, "Folded")
	matched, err := regexp.MatchString(`Folded [0-9]+ entr(y|ies) \([0-9]+ turns?\) into one note\.`, after.all())
	if err != nil || !matched {
		t.Errorf("the fold should report entries and turns, got transcript start:\n%s", truncate([]byte(after.all()), 600))
	}
	if len(after.entriesOf("pi.compaction")) == 0 {
		t.Errorf("the fold should land its summary card, got %s", strings.Join(after.kinds(), ","))
	}

}

// upload stages one file and answers its id: the bytes land under the workspace's
// hidden folder, never a host path the client named.
func (c *client) upload(workspace, name, mime string, content []byte) string {
	c.t.Helper()
	status, payload := c.uploadStatus(workspace, name, mime, content)
	if status != http.StatusCreated {
		c.t.Fatalf("upload %s: %d %s", name, status, payload)
	}
	var out struct {
		ID string `json:"id"`
	}
	if err := json.Unmarshal(payload, &out); err != nil || out.ID == "" {
		c.t.Fatalf("upload %s answered no id: %s", name, payload)
	}
	return out.ID
}

func (c *client) uploadStatus(workspace, name, mime string, content []byte) (int, []byte) {
	c.t.Helper()
	var body bytes.Buffer
	form := multipart.NewWriter(&body)
	part, err := form.CreatePart(textproto.MIMEHeader{
		"Content-Disposition": []string{`form-data; name="file"; filename="` + name + `"`},
		"Content-Type":        []string{mime},
	})
	if err != nil {
		c.t.Fatal(err)
	}
	if _, err := part.Write(content); err != nil {
		c.t.Fatal(err)
	}
	if err := form.Close(); err != nil {
		c.t.Fatal(err)
	}
	request, err := http.NewRequest(http.MethodPost, c.base+"/api/workspaces/"+workspace+"/attachments", &body)
	if err != nil {
		c.t.Fatal(err)
	}
	request.Header.Set("content-type", form.FormDataContentType())
	response, err := c.http.Do(request)
	if err != nil {
		c.t.Fatal(err)
	}
	defer response.Body.Close()
	payload, err := io.ReadAll(response.Body)
	if err != nil {
		c.t.Fatal(err)
	}
	return response.StatusCode, payload
}

// Files ride with a message: an upload stages bytes under the workspace's hidden
// folder, and a send with its id reaches the model, named in the transcript.
func TestAttachmentsRideAlong(t *testing.T) {
	t.Parallel()
	maybeSandbox(t)
	s := start(t, withScript(scriptRule{Match: "look at this", Reply: "seen"}))
	c := s.client()

	created := c.create("general")
	shot, err := base64.StdEncoding.DecodeString("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==")
	if err != nil {
		t.Fatal(err)
	}
	id := c.upload("general", "shot.png", "image/png", shot)
	// SVG is text: it rides inline, never as an image part the provider refuses.
	logo := c.upload("general", "logo.svg", "image/svg+xml", []byte(`<svg xmlns="http://www.w3.org/2000/svg"><circle r="10"/></svg>`))
	c.post(c.conversationPath("general", created.ID)+"/messages", map[string]any{
		"text":        "look at this",
		"attachments": []string{id, logo},
	}, nil)
	got := c.waitForText("general", created.ID, "seen")
	if !strings.Contains(got.all(), "Attached: shot.png") {
		t.Errorf("the sent message should name its file, got transcript:\n%s", truncate([]byte(got.all()), 600))
	}
	if !strings.Contains(got.all(), "<circle") {
		t.Errorf("svg should ride inline as text, got transcript:\n%s", truncate([]byte(got.all()), 600))
	}
}

// The caps refuse fast: an 11 MB file never reaches the worker.
func TestAttachmentsRefuseOversize(t *testing.T) {
	t.Parallel()
	notSandbox(t)
	s := start(t)
	c := s.client()

	status, payload := c.uploadStatus("general", "big.bin", "application/octet-stream", make([]byte, 11<<20))
	if status != http.StatusRequestEntityTooLarge {
		t.Errorf("an 11 MB file should refuse with 413, got %d %s", status, truncate(payload, 200))
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
	// Last activity is what the rail groups by, so a conversation that ran has to carry it.
	if idle.UpdatedAt == 0 {
		t.Error("the conversation should report when it last moved, so the rail can group by date")
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
