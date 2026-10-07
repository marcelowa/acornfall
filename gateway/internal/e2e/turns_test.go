package e2e

import (
	"strings"
	"testing"
	"time"
)

// A slash command is a message the user would otherwise retype. It is expanded on the way in,
// so the transcript records the text the model actually saw — which is the only way the
// command and its effect can be told apart later.
func TestCommandExpansionIsWhatTheModelSees(t *testing.T) {
	t.Parallel()
	maybeSandbox(t)
	s := start(t,
		withScript(scriptRule{Match: "EXPANDED:", Reply: "on it"}),
		withSetup(func(t *testing.T, s *system) {
			s.writeWorkspace(t, ".acornfall/commands/summarize.md",
				"---\nname: summarize\ndescription: Summarize something\nargument-hint: what to summarize\n---\nEXPANDED: summarize $ARGUMENTS, briefly.")
		}),
	)
	c := s.client()
	root := c.waitForConversation("general")

	c.prompt("general", root, "/summarize the notes")
	got := c.waitForText("general", root, "on it")

	user := lastEntryOfKind(got, "pi.user")
	if !strings.Contains(user, "EXPANDED: summarize the notes, briefly.") {
		t.Errorf("the message should be the expanded template, got %q", user)
	}
	if !strings.Contains(user, "EXPANDED:") || !strings.Contains(user, "the notes") {
		t.Errorf("the arguments should be in the template, got %q", user)
	}
	if strings.HasPrefix(strings.TrimSpace(user), "/summarize") {
		t.Errorf("the slash command itself should not be the message, got %q", user)
	}
}

// A template without a placeholder still gets the arguments: dropping what someone typed is
// worse than an extra line.
func TestCommandArgumentsAreAppendedWhenThereIsNoPlaceholder(t *testing.T) {
	t.Parallel()
	maybeSandbox(t)
	s := start(t,
		withScript(scriptRule{Match: "PING", Reply: "pong"}),
		withSetup(func(t *testing.T, s *system) {
			s.writeWorkspace(t, ".acornfall/commands/status.md", "---\nname: status\n---\nPING the status.")
		}),
	)
	c := s.client()
	root := c.waitForConversation("general")

	c.prompt("general", root, "/status everything please")
	got := c.waitForText("general", root, "pong")
	user := lastEntryOfKind(got, "pi.user")
	if !strings.Contains(user, "PING the status.") || !strings.Contains(user, "everything please") {
		t.Errorf("the body and the arguments should both be in the message, got %q", user)
	}
}

// A message that merely starts with a slash is not a command unless it names one.
func TestAnUnknownCommandIsSentAsWritten(t *testing.T) {
	t.Parallel()
	notSandbox(t)
	s := start(t, withScript(scriptRule{Match: "/not-a-command", Reply: "understood"}))
	c := s.client()
	root := c.waitForConversation("general")

	c.prompt("general", root, "/not-a-command does not exist")
	got := c.waitForText("general", root, "understood")
	user := lastEntryOfKind(got, "pi.user")
	if !strings.Contains(user, "/not-a-command does not exist") {
		t.Errorf("an unknown command should be sent as written, got %q", user)
	}
}

// The workspace's commands shadow the install's by name, and the listing says which file each
// came from, because "why is this command different here" is a question with an answer.
func TestCommandsComeFromBothLayersAndTheWorkspaceWins(t *testing.T) {
	t.Parallel()
	maybeSandbox(t)
	s := start(t, withSetup(func(t *testing.T, s *system) {
		s.writeHome(t, "commands/deploy.md", "---\nname: deploy\ndescription: the install's way\n---\nInstall deploy.")
		s.writeHome(t, "commands/shared.md", "---\nname: shared\ndescription: from the install\n---\nShared install body.")
		s.writeWorkspace(t, ".acornfall/commands/deploy.md", "---\nname: deploy\ndescription: this workspace's way\n---\nWorkspace deploy.")
	}))
	c := s.client()

	var listing struct {
		Commands []struct {
			Name        string `json:"name"`
			Description string `json:"description"`
			Source      string `json:"source"`
		} `json:"commands"`
	}
	c.get("/api/workspaces/general/commands", &listing)

	byName := map[string]string{}
	for _, command := range listing.Commands {
		byName[command.Name] = command.Description + "|" + command.Source
	}
	if len(listing.Commands) != 2 {
		t.Fatalf("expected two commands, got %+v", listing.Commands)
	}
	if !strings.Contains(byName["deploy"], "this workspace's way") || !strings.Contains(byName["deploy"], ".acornfall/commands") {
		t.Errorf("the workspace's command should win, got %q", byName["deploy"])
	}
	if !strings.Contains(byName["shared"], "from the install") {
		t.Errorf("the install's commands should still be listed, got %q", byName["shared"])
	}
}

// Steering is how a message joins work that is already running: it queues, and the run picks
// it up rather than being replaced by a second one.
func TestSteeringJoinsTheRunningTurn(t *testing.T) {
	t.Parallel()
	notSandbox(t)
	s := start(t,
		withSlowModel(),
		withScript(
			scriptRule{Match: "start the long job", Reply: "working on the long job now and this takes a while to say"},
			scriptRule{Match: "actually, also do this", Reply: "and the steered part is done too"},
		),
	)
	c := s.client()
	root := c.waitForConversation("general")
	defer c.watch("general", root)()

	c.prompt("general", root, "start the long job")
	c.waitRunning("general", root, 30*time.Second)
	c.promptWhenBusy("general", root, "actually, also do this", "steer")

	got := c.waitView("general", root, func(v view) bool {
		text := v.all()
		return strings.Contains(text, "and the steered part is done too")
	}, 120*time.Second)

	all := got.all()
	if !strings.Contains(all, "start the long job") || !strings.Contains(all, "actually, also do this") {
		t.Errorf("both messages should be in the transcript:\n%s", all)
	}
	// One run, not two: the steered message is answered after the first, inside the same one.
	if users := len(got.entriesOf("pi.user")); users != 2 {
		t.Errorf("expected exactly the two user messages, got %d:\n%s", users, all)
	}
	c.waitIdle("general", root, 60*time.Second)
}

// Abort stops what is running. The partial answer is not the whole answer, and the
// conversation is usable again afterwards.
func TestAbortStopsTheRun(t *testing.T) {
	t.Parallel()
	notSandbox(t)
	s := start(t,
		withSlowModel(),
		withScript(
			scriptRule{Match: "the long one", Reply: "a slow answer that goes on and on and on and on and on and on and finally says FINISHED"},
			scriptRule{Match: "the short one", Reply: "quick"},
		),
	)
	c := s.client()
	root := c.waitForConversation("general")
	defer c.watch("general", root)()

	c.prompt("general", root, "the long one")
	c.waitRunning("general", root, 30*time.Second)
	c.post(c.conversationPath("general", root)+"/abort", nil, nil)

	c.waitIdle("general", root, 30*time.Second)
	aborted := c.view("general", root)
	if strings.Contains(aborted.all(), "FINISHED") {
		t.Errorf("the answer should not have finished after an abort:\n%s", aborted.all())
	}
	if !strings.Contains(aborted.all(), "the long one") {
		t.Errorf("the message that was sent should still be recorded:\n%s", aborted.all())
	}

	// And the conversation still works.
	c.prompt("general", root, "the short one")
	c.waitForText("general", root, "quick")
}

// The stream is the interface's only live channel, so its contract is a feature: a full state
// on attach, whole transcripts as view frames, and a keepalive that arrives even when nothing
// is happening — which is what lets a client tell a quiet gateway from a dead one.
//
// The window is the keepalive interval plus a margin. It was 5s to watch a 3s ticker, which
// was a second and a half of the suite run spent waiting for a number the server had already
// promised.
func TestTheStreamSendsStateViewsAndKeepalives(t *testing.T) {
	t.Parallel()
	notSandbox(t)
	s := start(t, withScript(scriptRule{Match: "hello stream", Reply: "streamed"}))
	c := s.client()
	root := c.waitForConversation("general")
	c.prompt("general", root, "hello stream")
	c.waitForText("general", root, "streamed")

	counts := c.streamEvents("general", root, 4*time.Second)
	if counts["state"] == 0 {
		t.Errorf("a client that attaches should be told the state: %v", counts)
	}
	if counts["frame"] == 0 {
		t.Errorf("a client that attaches should be sent the transcript: %v", counts)
	}
	if counts["ping"] == 0 {
		t.Errorf("the keepalive should arrive within the window: %v", counts)
	}
}

// The conversation listing and the usage report are what a client shows beside the transcript.
func TestUsageIsReportedForAWorkspace(t *testing.T) {
	t.Parallel()
	notSandbox(t)
	s := start(t, withScript(scriptRule{Match: "spend something", Reply: "spent"}))
	c := s.client()
	root := c.waitForConversation("general")
	c.prompt("general", root, "spend something")
	c.waitForText("general", root, "spent")

	status, payload := c.do("GET", "/api/workspaces/general/usage", nil)
	if status != 200 {
		t.Fatalf("usage: %d %s", status, payload)
	}
	if len(payload) == 0 || string(payload) == "null" {
		t.Errorf("usage should report something: %s", payload)
	}
	if !strings.Contains(string(payload), root) && !strings.Contains(string(payload), "total") {
		t.Errorf("usage should be about the conversations that ran: %s", truncate(payload, 300))
	}

	conversation, _ := c.conversationIn("general", root)
	if conversation.Tokens <= 0 {
		t.Errorf("the conversation should report its spend, got %v", conversation.Tokens)
	}
	if conversation.Cost < 0 {
		t.Errorf("cost should not be negative, got %v", conversation.Cost)
	}
}

func lastEntryOfKind(v view, kind string) string {
	entries := v.entriesOf(kind)
	if len(entries) == 0 {
		return ""
	}
	return entries[len(entries)-1].text()
}
