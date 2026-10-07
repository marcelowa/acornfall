package e2e

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// A workspace's AGENTS.md is its rules. It reaches the prompt as its own section, so the
// model can tell the project's instructions from the platform's.
func TestWorkspaceRulesReachThePrompt(t *testing.T) {
	t.Parallel()
	maybeSandbox(t)
	s := start(t,
		withScript(scriptRule{Match: "get to work", Reply: "working"}),
		withSetup(func(t *testing.T, s *system) {
			s.writeWorkspace(t, "AGENTS.md", "RULES MARKER: this repository is a fruit stand.")
		}),
	)
	c := s.client()
	root := c.waitForConversation("general")

	c.prompt("general", root, "get to work")
	got := c.waitForText("general", root, "working")
	rules := got.systemSections()["workspace-rules"]
	if !strings.Contains(rules, "RULES MARKER") {
		t.Errorf("the workspace's rules should reach the prompt, got %q", rules)
	}
	if !strings.Contains(rules, "<workspace-rules>") {
		t.Errorf("the rules should be a section the model can recognise, got %q", rules)
	}
}

// Definitions come from two layers and the workspace shadows the global one by name, which is
// how a project overrides a shared agent without renaming it.
func TestAgentDefinitionsOverlayByLayer(t *testing.T) {
	t.Parallel()
	maybeSandbox(t)
	s := start(t,
		withScript(scriptRule{Match: "who are you", Reply: "an agent"}),
		withSetup(func(t *testing.T, s *system) {
			s.writeHome(t, "agents/researcher.md", "---\nname: researcher\ndescription: the global one\ndenying: bash\n---\nGlobal body.")
			s.writeHome(t, "agents/global-only.md", "---\nname: global-only\ndescription: only in the install\n---\nGlobal only body.")
			s.writeWorkspace(t, ".acornfall/agents/researcher.md", "---\nname: researcher\ndescription: the workspace one\n---\nWorkspace body.")
		}),
	)
	c := s.client()

	got := c.state("general")
	byName := map[string]struct {
		description string
		layer       string
		source      string
	}{}
	for _, agent := range got.Agents {
		byName[agent.Name] = struct {
			description string
			layer       string
			source      string
		}{agent.Description, agent.Layer, agent.Source}
	}
	if len(got.Agents) != 2 {
		t.Fatalf("expected two definitions, got %+v", got.Agents)
	}
	if byName["researcher"].description != "the workspace one" || byName["researcher"].layer != "workspace" {
		t.Errorf("a workspace definition should shadow the global one of the same name, got %+v", byName["researcher"])
	}
	if byName["global-only"].layer != "global" {
		t.Errorf("a global definition should still be offered, got %+v", byName["global-only"])
	}
	if !strings.Contains(byName["researcher"].source, ".acornfall/agents") {
		t.Errorf("the explain view should say which file won, got %s", byName["researcher"].source)
	}

	// A conversation can be pointed at one, and the state says which it runs.
	root := c.waitForConversation("general")
	c.post(c.conversationPath("general", root)+"/agent",
		map[string]any{"definition": "researcher"}, nil)
	got = c.state("general")
	if got.Agent.Definition != "researcher" {
		t.Errorf("the conversation should run the chosen definition, got %+v", got.Agent)
	}
	if resolved := got.Resolved; resolved != nil {
		if resolved["name"] != "researcher" {
			t.Errorf("the resolved agent should name the definition, got %+v", resolved)
		}
		instructions, _ := resolved["instructions"].(string)
		if !strings.Contains(instructions, "Workspace body.") {
			t.Errorf("the workspace definition's body should be its instructions, got %q", instructions)
		}
	}
}

// The config layers fold into one resolved agent: instructions concatenate global-then-
// workspace, tool denials union, and the explain view names every layer that contributed.
func TestConfigLayersFoldIntoOneAgent(t *testing.T) {
	t.Parallel()
	maybeSandbox(t)
	s := start(t,
		withScript(scriptRule{Match: "fold", Reply: "folded"}),
		withSetup(func(t *testing.T, s *system) {
			s.writeHome(t, "config.json", `{"defaults":{"instructions":"GLOBAL MARKER","denyTools":["bash"]}}`)
			s.writeWorkspace(t, ".acornfall/config.json", `{"defaults":{"instructions":"WORKSPACE MARKER","denyTools":["write"]}}`)
		}),
	)
	c := s.client()
	root := c.waitForConversation("general")

	c.prompt("general", root, "fold")
	got := c.waitForText("general", root, "folded")
	instructions := got.systemSections()["instructions"]
	globalAt := strings.Index(instructions, "GLOBAL MARKER")
	workspaceAt := strings.Index(instructions, "WORKSPACE MARKER")
	if globalAt < 0 || workspaceAt < 0 {
		t.Fatalf("both layers should contribute instructions, got %q", instructions)
	}
	if globalAt > workspaceAt {
		t.Errorf("the global layer should come first, got %q", instructions)
	}

	// The layer traces are what the inspector shows instead of asking anyone to guess.
	traces := c.state("general").Defaults
	layers := map[string]bool{}
	for _, trace := range traces {
		layers[trace.Layer] = true
	}
	if !layers["global"] || !layers["workspace"] {
		t.Errorf("every contributing layer should be reported, got %+v", traces)
	}
}

// The ecosystem's folder name is read the same way ours is, so a bundle written for another
// harness works here. Where a folder has both, ours wins: the interchange copy is what you
// share, and the local one is what overrides it.
func TestTheEcosystemAgentsFolderIsRead(t *testing.T) {
	t.Parallel()
	maybeSandbox(t)
	s := start(t,
		withScript(scriptRule{Match: "what are the rules", Reply: "answered"}),
		withSetup(func(t *testing.T, s *system) {
			// A complete bundle under the ecosystem name: rules, an agent, a command, a skill.
			s.writeWorkspace(t, ".agents/config.json", `{"defaults":{"instructions":"ECOSYSTEM MARKER"}}`)
			s.writeWorkspace(t, ".agents/agents/eco.md", "---\nname: eco\ndescription: from .agents\n---\nEco body.")
			s.writeWorkspace(t, ".agents/commands/eco.md", "---\nname: eco-command\ndescription: from .agents\n---\nEco body.")
			// The ecosystem's name for a prompt template, which is where another harness would
			// keep the same file.
			s.writeWorkspace(t, ".agents/prompts/eco-prompt.md", "---\nname: eco-prompt\ndescription: from prompts\n---\nEco prompt body.")
			s.writeWorkspace(t, ".agents/skills/eco-skill/SKILL.md", "---\nname: eco-skill\ndescription: from .agents\n---\nBody.")
			// And ours, shadowing the agent and the command by name.
			s.writeWorkspace(t, ".acornfall/agents/eco.md", "---\nname: eco\ndescription: from .acornfall\n---\nNative body.")
			s.writeWorkspace(t, ".acornfall/commands/eco.md", "---\nname: eco-command\ndescription: from .acornfall\n---\nNative body.")
		}),
	)
	c := s.client()

	listed := c.state("general")
	if len(listed.Agents) != 1 {
		t.Fatalf("expected the one definition, in both folders, got %+v", listed.Agents)
	}
	agent := listed.Agents[0]
	if !strings.Contains(agent.Description, "from .acornfall") || !strings.Contains(agent.Source, ".acornfall") {
		t.Errorf("our folder should shadow the ecosystem one, got %+v", agent)
	}

	var listing struct {
		Commands []struct {
			Name        string `json:"name"`
			Description string `json:"description"`
			Source      string `json:"source"`
		} `json:"commands"`
	}
	c.get("/api/workspaces/general/commands", &listing)
	if len(listing.Commands) != 2 {
		t.Fatalf("expected the command from both bundle names and the one from prompts, got %+v", listing.Commands)
	}
	byCommand := map[string]string{}
	for _, command := range listing.Commands {
		byCommand[command.Name] = command.Source
	}
	if !strings.Contains(byCommand["eco-command"], ".acornfall") {
		t.Errorf("our folder should shadow the ecosystem command, got %q", byCommand["eco-command"])
	}
	if !strings.Contains(byCommand["eco-prompt"], "/prompts/") {
		t.Errorf("a prompt template under the ecosystem's name should be read, got %q", byCommand["eco-prompt"])
	}

	// The explain view names the file each layer contributed, so where a rule came from is
	// answerable rather than inferred.
	paths := make([]string, 0, len(listed.Defaults))
	for _, trace := range listed.Defaults {
		paths = append(paths, trace.Path)
	}
	if !strings.Contains(strings.Join(paths, " "), ".agents/config.json") {
		t.Errorf("the layer trace should name the ecosystem file, got %v", paths)
	}

	// The skill and the rule reach the prompt, which is where they matter.
	root := c.waitForConversation("general")
	c.prompt("general", root, "what are the rules")
	view := c.waitForText("general", root, "answered")
	sections := strings.Join(sectionValues(view.systemSections()), "\n")
	for _, want := range []string{"ECOSYSTEM MARKER", "eco-skill"} {
		if !strings.Contains(sections, want) {
			t.Errorf("%s should reach the prompt, got %q", want, sections)
		}
	}
}

// Reload re-reads the files, so writing an agent does not mean restarting anything.
func TestReloadPicksUpANewDefinition(t *testing.T) {
	t.Parallel()
	maybeSandbox(t)
	s := start(t)
	c := s.client()
	root := c.waitForConversation("general")
	before := c.view("general", root)

	s.writeWorkspace(t, ".acornfall/agents/late.md", "---\nname: late\ndescription: written after startup\n---\nBody.")
	c.post("/api/workspaces/general/agents/reload", nil, nil)

	got := c.state("general")
	for _, agent := range got.Agents {
		if agent.Name == "late" {
			if before.systemSections() == nil {
				t.Log("no prompt yet; the definition still has to be listed")
			}
			return
		}
	}
	t.Fatalf("a definition written after startup should appear after a reload, got %+v", got.Agents)
}

// Skills reach the prompt by name and description only; the body is loaded when the model
// asks for it. An agent that names its skills offers only those.
func TestSkillsAreOfferedAndFilteredByAgent(t *testing.T) {
	t.Parallel()
	notSandbox(t)
	s := start(t,
		withScript(
			scriptRule{Match: "with skills", Reply: "offered"},
			scriptRule{Match: "without skills", Reply: "restricted"},
		),
		withSetup(func(t *testing.T, s *system) {
			s.writeHome(t, "skills/acorn-notes/SKILL.md", "---\nname: acorn-notes\ndescription: how to keep notes\n---\nLong body that should not be in the prompt.")
			s.writeHome(t, "agents/picky.md", "---\nname: picky\ndescription: only wants its own skill\nskills: some-other-skill\n---\nBody.")
		}),
	)
	c := s.client()
	root := c.waitForConversation("general")

	c.prompt("general", root, "with skills")
	offered := c.waitForText("general", root, "offered")
	all := strings.Join(sectionValues(offered.systemSections()), "\n")
	if !strings.Contains(all, "acorn-notes") {
		t.Errorf("the skill should be offered by name, got %q", all)
	}
	if strings.Contains(all, "Long body that should not be in the prompt") {
		t.Error("a skill's body should load only when the model asks for it")
	}

	c.post(c.conversationPath("general", root)+"/agent", map[string]any{"definition": "picky"}, nil)
	c.prompt("general", root, "without skills")
	restricted := c.waitForText("general", root, "restricted")
	if strings.Contains(strings.Join(sectionValues(restricted.systemSections()), "\n"), "acorn-notes") {
		t.Error("an agent that names its skills should not be offered the others")
	}
}

// A child runs the definition it was spawned as, so it is offered the skills that definition
// allows and no others. Only the open path recorded that list, so a spawned child was offered
// every skill the install has, whatever its definition said.
func TestASpawnedChildIsOfferedItsDefinitionsSkills(t *testing.T) {
	t.Parallel()
	maybeSandbox(t)
	s := start(t,
		withScript(
			scriptRule{
				Match: "spawn a picky one",
				Tools: []scriptTool{{Name: "subagent", Args: map[string]any{
					"action": "spawn", "name": "picky", "message": "picky task", "agent": "pick-one",
				}}},
				Reply: "started it",
			},
			scriptRule{Match: "picky task", Reply: "PICKY ANSWERED"},
		),
		withSetup(func(t *testing.T, s *system) {
			s.writeWorkspace(t, ".agents/skills/one/SKILL.md", "---\nname: one\ndescription: the first skill\n---\nBody.")
			s.writeWorkspace(t, ".agents/skills/two/SKILL.md", "---\nname: two\ndescription: the second skill\n---\nBody.")
			s.writeWorkspace(t, ".agents/agents/pick-one.md",
				"---\nname: pick-one\ndescription: names one skill of the two\nskills: one\n---\nBody.")
		}),
	)
	c := s.client()
	root := c.waitForConversation("general")

	c.prompt("general", root, "spawn a picky one")
	c.waitForText("general", root, "started it")
	child := c.waitForConversationMatching("general", func(candidate conversation) bool {
		return strings.Contains(candidate.Title, "picky task")
	})

	got := c.waitForText("general", child.ID, "PICKY ANSWERED")
	offered := got.systemSections()["skills"]
	if !strings.Contains(offered, "one") {
		t.Errorf("the child should be offered the skill its definition names:\n%q", offered)
	}
	if strings.Contains(offered, "two") {
		t.Errorf("and not the ones it does not:\n%q", offered)
	}
}

// A workspace whose harness cannot start is still a workspace: it says the harness is down and
// why, rather than taking the gateway with it. Fixing the file is enough.
func TestABrokenWorkspaceFileIsReportedAndHeals(t *testing.T) {
	t.Parallel()
	maybeSandbox(t)
	s := start(t,
		withScript(scriptRule{Match: "after the fix", Reply: "fixed"}),
		withSetup(func(t *testing.T, s *system) {
			// A guard with no reason: a mistake, and one the worker refuses to load.
			s.writeWorkspace(t, ".acornfall/config.json",
				`{"defaults":{"hooks":{"guards":[{"tool":"bash","arg":"command","pattern":"rm -rf"}]}}}`)
		}),
	)
	c := s.client()

	// The gateway is serving, and this workspace explains itself instead of refusing to
	// answer: a state a client can render, not an error it cannot.
	status, payload := c.do("GET", "/api/workspaces/general/state", nil)
	if status != 200 {
		t.Fatalf("a workspace whose harness is down should still answer with its state, got %d %s", status, truncate(payload, 200))
	}
	var got state
	decodeInto(t, "state", payload, &got)
	if got.Workspace.Name != "general" {
		t.Errorf("the state should be about the workspace asked for, got %+v", got.Workspace)
	}
	if got.WorkerUp {
		t.Fatal("a harness that cannot load its config must not report itself up")
	}
	// The reason settles a moment after the first refusal: the describe that loses the dead
	// process's stdout is superseded by the exit notification, whose message carries the
	// harness's own last words. Reading once raced that window — one run in six saw
	// "describe worker: worker stdout closed" instead of the file at fault.
	deadline := time.Now().Add(30 * time.Second)
	for {
		got = c.state("general")
		if strings.Contains(got.WorkerError, "reason") && strings.Contains(got.WorkerError, "config.json") {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("the state should carry the harness's own reason, naming config.json, got %q", got.WorkerError)
		}
		time.Sleep(50 * time.Millisecond)
	}

	// Fixing the file is enough: the supervisor keeps trying, and nothing needs a restart.
	s.writeWorkspace(t, ".acornfall/config.json",
		`{"defaults":{"hooks":{"guards":[{"tool":"bash","arg":"command","pattern":"rm -rf","reason":"now it has one"}]}}}`)
	deadline = time.Now().Add(90 * time.Second)
	for time.Now().Before(deadline) {
		if c.state("general").WorkerUp {
			break
		}
		time.Sleep(time.Second)
	}
	if !c.state("general").WorkerUp {
		t.Fatalf("the harness should come back once the file is fixed, still: %q", c.state("general").WorkerError)
	}
	root := c.waitForConversation("general")
	c.prompt("general", root, "after the fix")
	c.waitForText("general", root, "fixed")
}

// A global skill is read from the host, so its body arrives as text — and the directory it
// names has to exist inside the sandbox, or an instruction like "run scripts/run.sh" fails
// at the first command while the model has no way to tell why. The resource folders are
// mounted at their own paths, read-only, and config.json when it is there.
func TestAGlobalSkillsScriptRunsInsideTheWorkspace(t *testing.T) {
	t.Parallel()
	maybeSandbox(t)
	s := start(t,
		withScript(
			scriptRule{
				Match: "load the global skill",
				Tools: []scriptTool{{Name: "skill", Args: map[string]any{"name": "greeting"}}},
				Reply: "loaded the skill",
			},
			scriptRule{
				Match: "run the script",
				Tools: []scriptTool{{Name: "bash", Args: map[string]any{
					// The user message carries the command, because the directory is the one the
					// skill reported a moment ago and only the transcript knows it.
					"command": map[string]any{"$fromTranscript": `RUN: (.*)`},
				}}},
				Reply: "ran the global script",
			},
		),
		withSetup(func(t *testing.T, s *system) {
			s.writeHome(t, ".agents/skills/greeting/SKILL.md",
				"---\nname: greeting\ndescription: greets from a script\n---\nRun scripts/run.sh from this directory.")
			// The write is what proves the mount is read-only: the skill's own folder is the
			// thing self-modification would edit, so it is the thing the engine must refuse.
			s.writeHome(t, ".agents/skills/greeting/run.sh",
				"echo GLOBAL-SCRIPT-RAN\n"+
					"if echo x > \"$(dirname \"$0\")/marker\" 2>/dev/null; then echo SKILL-WRITABLE; else echo SKILL-READ-ONLY; fi\n")
			s.writeHome(t, "config.json", `{"defaults":{"instructions":"INSTALL CONFIG MARKER"}}`)
		}),
	)
	c := s.client()
	root := c.waitForConversation("general")

	c.prompt("general", root, "load the global skill")
	loaded := c.waitForText("general", root, "loaded the skill")
	skillResult := loaded.toolResults()[0]
	directory := skillDirectory(t, skillResult)
	if _, err := os.Stat(filepath.Join(directory, "run.sh")); err != nil {
		t.Fatalf("the skill should report where its instructions are: %v", err)
	}

	c.prompt("general", root, fmt.Sprintf("run the script \u2014 RUN: sh %s && cat %s",
		filepath.Join(directory, "run.sh"), filepath.Join(s.Home, "config.json")))
	got := c.waitForText("general", root, "ran the global script")

	ran := got.lastToolResult()
	if !strings.Contains(ran, "GLOBAL-SCRIPT-RAN") {
		t.Errorf("the global script should run inside the sandbox, got %q", ran)
	}
	if strings.Contains(ran, "SKILL-WRITABLE") {
		t.Errorf("the skill folder must be mounted read-only, got %q", ran)
	}
	if !strings.Contains(ran, "SKILL-READ-ONLY") {
		t.Errorf("the script should report the refusal, got %q", ran)
	}
	if !strings.Contains(ran, "INSTALL CONFIG MARKER") {
		t.Errorf("the install config.json should be readable inside the sandbox, got %q", ran)
	}
	if _, err := os.Stat(filepath.Join(directory, "marker")); err == nil {
		t.Error("a write into a resource folder escaped the read-only mount")
	}
}

// skillDirectory reads the directory the skill tool reported, which is the path the model
// would use from the instructions.
func skillDirectory(t *testing.T, result string) string {
	t.Helper()
	for _, line := range strings.Split(result, "\n") {
		if directory, found := strings.CutPrefix(line, "Directory: "); found {
			return strings.TrimSpace(directory)
		}
	}
	t.Fatalf("the skill result should name its directory, got %q", result)
	return ""
}

func sectionValues(sections map[string]string) []string {
	values := make([]string, 0, len(sections))
	for _, value := range sections {
		values = append(values, value)
	}
	return values
}
