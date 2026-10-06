package e2e

import (
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// Each workspace is its own everything: its own folder, its own harness process, its own
// history. A second workspace is created by name and is usable immediately.
func TestWorkspacesAreIsolatedAndStartOnDemand(t *testing.T) {
	s := start(t, withScript(scriptRule{Match: "in the other workspace", Reply: "answered elsewhere"}))
	c := s.client()

	// Nothing but general is running before anything asks for it.
	c.createWorkspace("second")
	after := c.state("general")
	if len(after.Workspaces) != 2 {
		t.Fatalf("expected two workspaces, got %+v", after.Workspaces)
	}
	if len(after.Conversations) != 1 {
		t.Errorf("creating a workspace must not add conversations to another one, got %d", len(after.Conversations))
	}

	// The new workspace has its own root conversation, its own worker, and its own storage.
	second := c.state("second")
	if second.Workspace.Name != "second" {
		t.Fatalf("the state should be about the workspace asked for, got %q", second.Workspace.Name)
	}
	root := c.waitForConversation("second")
	if root == "" || len(second.Conversations) != 1 {
		t.Fatalf("a new workspace should have its own root conversation, got %+v", second.Conversations)
	}
	// The folder is created inside the workspaces folder, by name.
	if want := filepath.Join(s.WorkspacesDir, "second"); second.Workspace.Path != want {
		t.Errorf("the folder should be %s, got %s", want, second.Workspace.Path)
	}
	if _, err := os.Stat(filepath.Join(s.Home, "state", "second", "session.sqlite")); err != nil {
		t.Errorf("each workspace keeps its own storage: %v", err)
	}

	c.prompt("second", root, "in the other workspace")
	c.waitForText("second", root, "answered elsewhere")

	// The two histories stay apart. Conversation ids are the harness's own and are unique
	// only within a workspace, so both workspaces can have a conversation "1" — which is why
	// a route always names the workspace. What must not leak is the content.
	first := c.state("general")
	if len(first.Conversations) != 1 || first.Conversations[0].ID != "1" {
		t.Fatalf("general should still have only its own root conversation, got %+v", first.Conversations)
	}
	generalView := c.view("general", first.Conversation.ID)
	if strings.Contains(generalView.all(), "answered elsewhere") {
		t.Errorf("a conversation in one workspace leaked into another:\n%s", generalView.all())
	}
}

// The interface creates a workspace by name inside one folder; a path is refused rather than
// ignored, because accepting and dropping it would be a field that does nothing.
func TestWorkspaceCreationTakesANameAndRefusesAPath(t *testing.T) {
	s := start(t)
	c := s.client()

	status, body := c.postStatus("/api/workspaces", map[string]any{"name": "with-a-path", "path": "/etc"})
	if status == 400 {
		if !strings.Contains(body, "acornfall workspace add") {
			t.Errorf("the refusal should say what to use instead, got %q", body)
		}
	} else {
		t.Errorf("a path should be refused, got %d", status)
	}
	if _, err := os.Stat("/etc/.acornfall"); err == nil {
		t.Error("a workspace must never be created outside the workspaces folder")
	}

	// A name that already exists as a folder is adopted rather than refused: someone who made
	// the folder themselves means it.
	if err := os.MkdirAll(filepath.Join(s.WorkspacesDir, "prepared"), 0o755); err != nil {
		t.Fatal(err)
	}
	c.createWorkspace("prepared")
	got := c.state("prepared")
	if got.Workspace.Path != filepath.Join(s.WorkspacesDir, "prepared") {
		t.Errorf("an existing folder should be adopted, got %s", got.Workspace.Path)
	}

	// A name with a slash is not a name.
	status, _ = c.postStatus("/api/workspaces", map[string]any{"name": "../escape"})
	if status == 200 {
		t.Error("a name containing a path separator should be refused")
	}
}

// Removing a workspace forgets it. It never deletes the folder or the history, and the
// general one cannot be removed at all.
func TestRemovingAWorkspaceKeepsItsFolderAndHistory(t *testing.T) {
	s := start(t, withScript(scriptRule{Match: "remember me", Reply: "remembered"}))
	c := s.client()

	c.createWorkspace("doomed")
	root := c.waitForConversation("doomed")
	c.prompt("doomed", root, "remember me")
	c.waitForText("doomed", root, "remembered")

	folder := filepath.Join(s.WorkspacesDir, "doomed")
	c.post("/api/workspaces/doomed/remove", nil, nil)

	after := c.state("general")
	for _, workspace := range after.Workspaces {
		if workspace.Name == "doomed" {
			t.Fatalf("the workspace should be forgotten, got %+v", after.Workspaces)
		}
	}
	if _, err := os.Stat(folder); err != nil {
		t.Errorf("removing a workspace must not delete the folder: %v", err)
	}
	if _, err := os.Stat(filepath.Join(s.Home, "state", "doomed", "session.sqlite")); err != nil {
		t.Errorf("removing a workspace must not delete its history: %v", err)
	}
	// Its worker is stopped with it, so a removed workspace costs nothing.
	for _, workspace := range after.Workspaces {
		if workspace.Name == "doomed" && workspace.Running {
			t.Error("a removed workspace should not still be running")
		}
	}

	if status, body := c.postStatus("/api/workspaces/general/remove", nil); status == 200 {
		t.Error("the general workspace cannot be removed")
	} else if !strings.Contains(body, "general") {
		t.Errorf("the refusal should name the workspace, got %q", body)
	}
}

// A workspace's own resources are read: its rules, its guards, its agents, its commands.
//
// There used to be a trust flag that decided this, and the second half of this test used to
// flip it and watch everything disappear. What that bought was thin: the folder the agent works
// in was the one folder it could not take instructions from, while its tools stayed free to read
// the whole machine. Reach is the sandbox's business, and this is not it.
func TestAWorkspacesOwnResourcesAreRead(t *testing.T) {
	guard := `{"defaults":{"hooks":{"guards":[{"tool":"bash","arg":"command","pattern":"rm -rf","reason":"no destructive commands here"}]}}}`
	s := start(t,
		withScript(scriptRule{
			Match: "tidy up",
			Tools: []scriptTool{{Name: "bash", Args: map[string]any{"command": "rm -rf build"}}},
			Reply: "cleaned up",
		}),
		withSetup(func(t *testing.T, s *system) {
			s.writeWorkspace(t, "AGENTS.md", "WORKSPACE RULES MARKER: keep the build directory")
			s.writeWorkspace(t, ".acornfall/config.json", guard)
			s.writeWorkspace(t, ".acornfall/agents/local.md", "---\nname: local-agent\ndescription: from this workspace\n---\nBody.")
			s.writeWorkspace(t, ".acornfall/commands/local.md", "---\nname: local-command\ndescription: from this workspace\n---\nDo the local thing.")
		}),
	)
	c := s.client()
	root := c.waitForConversation("general")

	got := c.state("general")
	if len(got.Agents) != 1 || got.Agents[0].Name != "local-agent" {
		t.Errorf("a workspace's agents should be offered, got %+v", got.Agents)
	}
	var commands struct {
		Commands []struct {
			Name   string `json:"name"`
			Source string `json:"source"`
		} `json:"commands"`
	}
	c.get("/api/workspaces/general/commands", &commands)
	found := false
	for _, command := range commands.Commands {
		if command.Name == "local-command" {
			found = true
		}
	}
	if !found {
		t.Errorf("a workspace's commands should be offered, got %+v", commands.Commands)
	}
	// The layer traces name the file each folder contributed, which is how a reader can tell
	// where a rule came from at all.
	if len(got.Defaults) == 0 || got.Defaults[len(got.Defaults)-1].Path == "" {
		t.Errorf("the workspace's config should be a reported layer, got %+v", got.Defaults)
	}

	// A prompt is what builds a system entry, so the prompt is where "what does the model see"
	// is answerable.
	c.prompt("general", root, "tidy up")
	running := c.waitForText("general", root, "cleaned up")
	if !strings.Contains(running.systemSections()["workspace-rules"], "WORKSPACE RULES MARKER") {
		t.Errorf("a workspace's AGENTS.md should reach the prompt, got %q", running.systemSections()["workspace-rules"])
	}
	if !strings.Contains(running.lastToolResult(), "no destructive commands here") {
		t.Errorf("a workspace's guard should block, got %q", running.lastToolResult())
	}
}

// The flag is gone, and a caller that still sends it is told so rather than humoured: a request
// for the old behaviour that quietly gets the new one is a lie in the other direction.
func TestTheTrustFlagIsGone(t *testing.T) {
	s := start(t)
	c := s.client()

	status, body := c.postStatus("/api/workspaces", map[string]any{"name": "untrusted-one", "trusted": false})
	if status != http.StatusBadRequest {
		t.Errorf("creating with a trust flag should be refused, got %d", status)
	}
	if !strings.Contains(body, "no trust flag") {
		t.Errorf("the refusal should say why, got %q", body)
	}

	status, body = c.postStatus("/api/workspaces/general/update", map[string]any{"trusted": false})
	if status != http.StatusBadRequest {
		t.Errorf("updating with a trust flag should be refused, got %d", status)
	}
	if !strings.Contains(body, "no trust flag") {
		t.Errorf("the refusal should say why, got %q", body)
	}

	// And the workspace it was aimed at is untouched and still serving.
	if got := c.state("general"); got.Workspace.Name != "general" || !got.WorkerUp {
		t.Errorf("a refused update should change nothing, got %+v", got.Workspace)
	}
}
