package e2e

import (
	"os"
	"os/exec"
	"strings"
	"syscall"
	"testing"
	"time"
)

// Delegation: a task handed to a subagent comes back as the answer to the call, and the
// subagent is a real conversation with the parent recorded on it.
func TestDelegateWaitsForTheChildAndReturnsItsAnswer(t *testing.T) {
	s := start(t, withScript(
		scriptRule{
			Match: "delegate this",
			Tools: []scriptTool{{Name: "delegate", Args: map[string]any{"task": "child task: say the marker"}}},
			Reply: "the child answered",
		},
		scriptRule{Match: "child task", Reply: "CHILD ANSWER MARKER"},
	))
	c := s.client()
	root := c.waitForConversation("general")

	c.prompt("general", root, "delegate this")
	got := c.waitForText("general", root, "the child answered")

	// The answer is delivered as the result of the call, which is what "waits for it" means.
	if !strings.Contains(got.all(), "CHILD ANSWER MARKER") {
		t.Errorf("the child's answer should come back to the caller:\n%s", got.all())
	}

	// The child is a conversation in its own right, owned by the conversation that made it.
	child := c.waitForConversationMatching("general", func(candidate conversation) bool {
		return candidate.Parent == root && candidate.ID != root
	})
	if child.Root {
		t.Error("a subagent is not the root conversation")
	}
	childView := c.view("general", child.ID)
	if !strings.Contains(childView.all(), "child task: say the marker") {
		t.Errorf("the subagent should have been given the task:\n%s", childView.all())
	}
	if !strings.Contains(childView.all(), "CHILD ANSWER MARKER") {
		t.Errorf("the subagent should have answered in its own transcript:\n%s", childView.all())
	}
}

// A peer is a conversation like any other: it appears in the list, it is not owned by the
// conversation that made it, and it outlives it.
func TestAPeerIsANormalConversation(t *testing.T) {
	s := start(t, withScript(
		scriptRule{
			Match: "make a peer",
			Tools: []scriptTool{{Name: "subagent", Args: map[string]any{
				"action": "spawn", "peer": true, "name": "helper", "message": "peer task: say hello",
			}}},
			Reply: "the peer is running",
		},
		scriptRule{Match: "peer task", Reply: "PEER ANSWER MARKER"},
	))
	c := s.client()
	root := c.waitForConversation("general")

	c.prompt("general", root, "make a peer")
	c.waitForText("general", root, "the peer is running")

	peer := c.waitForConversationMatching("general", func(candidate conversation) bool {
		return candidate.CreatedBy == root && candidate.ID != root
	})
	if peer.Parent != "" {
		t.Errorf("a peer is not owned by its creator, got parent %q", peer.Parent)
	}
	if peer.CreatedBy != root {
		t.Errorf("the peer should record who made it, got %q", peer.CreatedBy)
	}
	c.waitForText("general", peer.ID, "PEER ANSWER MARKER")
}

// The subagent tool's own actions answer in the tool result rather than in the rail: the listing
// names what this conversation made and what each one has spent.
func TestSubagentListNamesWhatEachChildSpent(t *testing.T) {
	s := start(t, withScript(
		scriptRule{
			Match: "start a helper",
			Tools: []scriptTool{{Name: "subagent", Args: map[string]any{
				"action": "spawn", "name": "helper", "message": "helper task",
			}}},
			Reply: "the helper is running",
		},
		scriptRule{Match: "helper task", Reply: "HELPER ANSWERED"},
		scriptRule{
			Match: "list the helpers",
			Tools: []scriptTool{{Name: "subagent", Args: map[string]any{"action": "list"}}},
			Reply: "listed them",
		},
	))
	c := s.client()
	root := c.waitForConversation("general")

	c.prompt("general", root, "start a helper")
	c.waitForText("general", root, "the helper is running")
	child := c.waitForConversationMatching("general", func(candidate conversation) bool {
		return candidate.Parent == root && candidate.ID != root
	})

	c.prompt("general", root, "list the helpers")
	got := c.waitForText("general", root, "listed them")
	transcript := got.all()
	for _, want := range []string{"helper", "conversation " + child.ID, "tokens"} {
		if !strings.Contains(transcript, want) {
			t.Errorf("the listing should mention %q:\n%s", want, transcript)
		}
	}
}

// What a spawned child runs comes from three places, and they have an order: what this
// conversation runs, then what its definition says, then what the caller asked for. The order
// was reversed, so an override lost to the definition it was meant to beat, and the definition's
// level was read and then dropped, so naming one made no difference to a spawned child at all.
func TestASpawnedChildsLevelFollowsTheDocumentedOrder(t *testing.T) {
	s := start(t,
		withScript(
			scriptRule{
				Match: "spawn one",
				Tools: []scriptTool{{Name: "subagent", Args: map[string]any{
					"action": "spawn", "name": "one", "message": "helper task one", "agent": "thinky",
				}}},
				Reply: "started one",
			},
			scriptRule{
				Match: "spawn two",
				Tools: []scriptTool{{Name: "subagent", Args: map[string]any{
					"action": "spawn", "name": "two", "message": "helper task two", "agent": "thinky",
					"thinking": "low",
				}}},
				Reply: "started two",
			},
		),
		withSetup(func(t *testing.T, s *system) {
			s.writeWorkspace(t, ".agents/agents/thinky.md",
				"---\nname: thinky\ndescription: names a level of its own\nthinking: high\n---\nBody.")
		}),
	)
	c := s.client()
	root := c.waitForConversation("general")

	c.prompt("general", root, "spawn one")
	c.waitForText("general", root, "started one")
	// The task arrives with its attribution, so the title is "[from conversation 1] helper task
	// one": the delegation says where a message came from, which is the point of it.
	fromDefinition := c.waitForConversationMatching("general", func(candidate conversation) bool {
		return strings.Contains(candidate.Title, "helper task one")
	})
	if fromDefinition.Thinking != "high" {
		t.Errorf("the definition's level should apply to the child, got %q", fromDefinition.Thinking)
	}

	c.prompt("general", root, "spawn two")
	c.waitForText("general", root, "started two")
	fromCaller := c.waitForConversationMatching("general", func(candidate conversation) bool {
		return strings.Contains(candidate.Title, "helper task two")
	})
	if fromCaller.Thinking != "low" {
		t.Errorf("the caller's level should beat the definition's, got %q", fromCaller.Thinking)
	}
}

// An answer comes back to the conversation that asked for it, however it addressed the one it
// asked: by name, or by the id a listing handed it. The id form delivered the message and then
// dropped the answer — the reporter had nothing to attribute it to — while the tool told the
// model the answer would come back.
func TestASendByConversationIdReportsItsAnswer(t *testing.T) {
	s := start(t, withScript(
		scriptRule{
			Match: "start a helper",
			Tools: []scriptTool{{Name: "subagent", Args: map[string]any{
				"action": "spawn", "name": "helper", "message": "first task",
			}}},
			Reply: "started it",
		},
		scriptRule{Match: "first task", Reply: "FIRST ANSWER"},
		scriptRule{
			Match: "list the helpers",
			Tools: []scriptTool{{Name: "subagent", Args: map[string]any{"action": "list"}}},
			Reply: "listed them",
		},
		scriptRule{
			Match: "send it another task by id",
			Tools: []scriptTool{{Name: "subagent", Args: map[string]any{
				"action": "send",
				// The id exists only at runtime, so the script reads it out of the listing.
				"conversation": map[string]any{"$fromTranscript": `conversation (\d+)`},
				"message":      "second task",
			}}},
			Reply: "sent by id",
		},
		scriptRule{Match: "second task", Reply: "SECOND ANSWER"},
	))
	c := s.client()
	root := c.waitForConversation("general")

	c.prompt("general", root, "start a helper")
	c.waitForText("general", root, "started it")
	c.prompt("general", root, "list the helpers")
	c.waitForText("general", root, "listed them")
	c.prompt("general", root, "send it another task by id")
	c.waitForText("general", root, "sent by id")

	// The wake itself, and the label on it: the answer is attributed to the name this
	// conversation knows, not to the id it happened to address.
	// A wake either arrives within a second or never does, so a short window here keeps a
	// regression from taking a minute to say so.
	woken := c.waitView("general", root, func(v view) bool {
		return strings.Contains(v.all(), "SECOND ANSWER")
	}, 20*time.Second)
	if !strings.Contains(woken.all(), "[from subagent helper]") {
		t.Errorf("the answer should say which conversation it came from:\n%s", woken.all())
	}
}

// A thinking level that does not exist is refused wherever it came from, and the refusal is what
// the model sees: the level in a definition, and the level the model itself passes as an
// argument. Both go through the check the open path uses, and a refusal is not a spawn.
func TestAnUnknownThinkingLevelIsRefusedNotPassedOn(t *testing.T) {
	s := start(t,
		withScript(
			scriptRule{
				Match: "spawn with a bad level",
				Tools: []scriptTool{{Name: "subagent", Args: map[string]any{
					"action": "spawn", "name": "helper", "message": "helper task", "thinking": "banana",
				}}},
				Reply: "I was refused",
			},
			scriptRule{
				Match: "delegate to the broken agent",
				Tools: []scriptTool{{Name: "delegate", Args: map[string]any{
					"task": "child task", "agent": "broken-level",
				}}},
				Reply: "that was refused too",
			},
		),
		withSetup(func(t *testing.T, s *system) {
			s.writeWorkspace(t, ".agents/agents/broken-level.md",
				"---\nname: broken-level\ndescription: a level that does not exist\nthinking: banana\n---\nBody.")
		}),
	)
	c := s.client()
	root := c.waitForConversation("general")

	c.prompt("general", root, "spawn with a bad level")
	first := c.waitForText("general", root, "I was refused")
	if !strings.Contains(first.all(), `unknown thinking level "banana"`) {
		t.Errorf("the refusal should name the level the model asked for:\n%s", first.all())
	}

	c.prompt("general", root, "delegate to the broken agent")
	second := c.waitForText("general", root, "that was refused too")
	if !strings.Contains(second.all(), `unknown thinking level "banana"`) {
		t.Errorf("a definition's level should be refused too:\n%s", second.all())
	}

	// Neither refusal created anything: the check happens before the commit, not inside it.
	if listing := c.conversations("general"); len(listing) != 1 {
		t.Errorf("a refused spawn should create no conversation, got %+v", listing)
	}
}

// The policy in the overlay decides what a conversation may do, and it is reported, so a
// refusal can be explained rather than only suffered.
func TestDelegationPolicyCanForbidSpawning(t *testing.T) {
	s := start(t,
		withScript(scriptRule{
			Match: "delegate this",
			Tools: []scriptTool{{Name: "delegate", Args: map[string]any{"task": "child task"}}},
			Reply: "I could not delegate",
		}),
		withSetup(func(t *testing.T, s *system) {
			s.writeWorkspace(t, ".acornfall/config.json", `{"defaults":{"delegation":{"spawn":false,"peers":false}}}`)
		}),
	)
	c := s.client()
	root := c.waitForConversation("general")

	var policy struct {
		CanSpawn bool `json:"canSpawn"`
	}
	c.get(c.conversationPath("general", root)+"/policy", &policy)
	if policy.CanSpawn {
		t.Error("the workspace config forbids spawning, so the policy should say so")
	}

	c.prompt("general", root, "delegate this")
	got := c.waitForText("general", root, "I could not delegate")
	if !strings.Contains(got.all(), "Cannot delegate from here") {
		t.Errorf("the refusal should be told to the model:\n%s", got.all())
	}
	// Nothing was created.
	for _, candidate := range c.state("general").Conversations {
		if candidate.Parent == root || candidate.CreatedBy == root {
			t.Errorf("a forbidden subagent must not exist: %+v", candidate)
		}
	}
}

// Liveness: the harness is a process, and a process can die. Its history is in storage, so
// replacing it is invisible apart from the pause — the workspace, its conversations, and
// their transcripts are all still there afterwards.
func TestTheHarnessRestartsAndKeepsItsHistory(t *testing.T) {
	s := start(t, withScript(
		scriptRule{Match: "before the crash", Reply: "BEFORE MARKER"},
		scriptRule{Match: "after the crash", Reply: "AFTER MARKER"},
	))
	c := s.client()
	root := c.waitForConversation("general")
	c.prompt("general", root, "before the crash")
	c.waitForText("general", root, "BEFORE MARKER")

	killWorker(t, s)

	// It comes back on its own, without anything being restarted by hand.
	deadline := time.Now().Add(60 * time.Second)
	for time.Now().Before(deadline) {
		if c.state("general").WorkerUp {
			break
		}
		time.Sleep(200 * time.Millisecond)
	}
	if !c.state("general").WorkerUp {
		t.Fatalf("the harness should be restarted, got %q", c.state("general").WorkerError)
	}

	// The conversation and its transcript are the harness's storage, not the process.
	after := c.state("general")
	if after.Conversation == nil || after.Conversation.ID != root {
		t.Fatalf("the workspace should land on the same conversation, got %+v", after.Conversation)
	}
	// Waited for rather than read once: the first frame after a restart is the empty view a
	// fresh attachment starts from, and the replay arrives with the next one.
	view := c.waitView("general", root, func(v view) bool {
		return strings.Contains(v.all(), "BEFORE MARKER")
	}, 60*time.Second)
	if !strings.Contains(view.all(), "BEFORE MARKER") {
		t.Errorf("the transcript should survive the restart:\n%s", view.all())
	}

	// And it still works.
	c.prompt("general", root, "after the crash")
	c.waitForText("general", root, "AFTER MARKER")
}

// A run that was interrupted by the crash finishes afterwards: work is committed before it is
// shown, so the new process picks it up from the last commit.
func TestAnInterruptedRunFinishesAfterARestart(t *testing.T) {
	s := start(t,
		withSlowModel(),
		withScript(scriptRule{Match: "the long one", Reply: "a slow answer that goes on and on and on and on and on and finally says FINISHED"}),
	)
	c := s.client()
	root := c.waitForConversation("general")
	defer c.watch("general", root)()

	c.prompt("general", root, "the long one")
	c.waitRunning("general", root, 30*time.Second)

	killWorker(t, s)
	// FINISHED is the last word of the answer: seeing it means the run completed, not that a
	// partial transcript was replayed.
	c.waitView("general", root, func(v view) bool {
		return strings.Contains(v.all(), "FINISHED")
	}, 180*time.Second)
}

// killWorker ends the harness process the way a crash would: no protocol, no cleanup.
func killWorker(t *testing.T, s *system) {
	t.Helper()
	out, err := exec.Command("pgrep", "-f", "src/main.ts --workspace "+s.General).Output()
	if err != nil {
		t.Fatalf("no worker process found for %s: %v", s.General, err)
	}
	for _, field := range strings.Fields(string(out)) {
		pid := 0
		for _, digit := range field {
			if digit < '0' || digit > '9' {
				pid = 0
				break
			}
			pid = pid*10 + int(digit-'0')
		}
		if pid <= 0 {
			continue
		}
		process, err := os.FindProcess(pid)
		if err != nil {
			t.Fatal(err)
		}
		if err := process.Signal(syscall.SIGKILL); err != nil {
			t.Fatalf("kill worker %d: %v", pid, err)
		}
		t.Logf("killed worker %d", pid)
		return
	}
	t.Fatalf("no worker pid in %q", out)
}
