// Package e2e drives a real gateway, a real worker, and a scripted provider over HTTP. It
// is the only place a feature is exercised through every layer at once: the flags a person
// runs it with, the JSONL worker protocol, the durable store, and the tool loop.
//
// What it deliberately is not: a unit test. Anything that can be decided without a process
// belongs in the package that owns the rule, where it runs in microseconds. These tests
// exist for the things that only break when the layers disagree — a frame that is not
// published, a resolution that is not applied, a restart that loses a run.
//
// Nothing here touches the network or a provider: `faux/faux-1` is scripted, so a failing
// test is reproducible and free.
package e2e

import (
	"bufio"
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"sync"
	"testing"
	"time"
)

var (
	repoRoot   string
	gatewayBin string
	workerDir  string
	skipReason string
)

func TestMain(m *testing.M) {
	_, file, _, _ := runtime.Caller(0)
	repoRoot = filepath.Clean(filepath.Join(filepath.Dir(file), "..", "..", ".."))
	workerDir = filepath.Join(repoRoot, "worker")

	// The suite needs bun and an installed worker. Without them, skipping is honest:
	// a missing toolchain is not a broken feature.
	switch {
	case which("bun") == "":
		skipReason = "bun is not on PATH"
	case which("go") == "":
		skipReason = "go is not on PATH"
	case !exists(filepath.Join(workerDir, "node_modules", "@earendil-works")):
		skipReason = "worker dependencies are not installed (make deps)"
	}

	if skipReason == "" {
		dir, err := os.MkdirTemp("", "acornfall-e2e-*")
		if err != nil {
			panic(err)
		}
		defer os.RemoveAll(dir)
		gatewayBin = filepath.Join(dir, "acornfall")
		build := exec.Command("go", "build", "-o", gatewayBin, "./cmd/acornfall")
		build.Dir = filepath.Join(repoRoot, "gateway")
		if out, err := build.CombinedOutput(); err != nil {
			panic(fmt.Sprintf("build gateway: %v\n%s", err, out))
		}
	}
	os.Exit(m.Run())
}

func which(name string) string {
	path, err := exec.LookPath(name)
	if err != nil {
		return ""
	}
	return path
}

func exists(path string) bool {
	_, err := os.Stat(path)
	return err == nil
}

/* ---------- starting the system ---------- */

type scriptTool struct {
	Name string         `json:"name"`
	Args map[string]any `json:"args,omitempty"`
}

type scriptRule struct {
	Match string       `json:"match,omitempty"`
	Reply string       `json:"reply,omitempty"`
	Tools []scriptTool `json:"tools,omitempty"`
}

type setup func(t *testing.T, s *system)

type settings struct {
	script []scriptRule
	slow   bool
	flags  []string
	setup  []setup
}

// withScript is what the model does: the first rule whose Match is a substring of the last
// user message wins, its tools are called, and then its Reply is the answer.
func withScript(rules ...scriptRule) func(*settings) {
	return func(s *settings) { s.script = rules }
}

// withSlowModel streams slowly enough that a turn is still running while the test acts.
func withSlowModel() func(*settings) {
	return func(s *settings) { s.slow = true }
}

func withFlags(flags ...string) func(*settings) {
	return func(s *settings) { s.flags = append(s.flags, flags...) }
}

// withSetup writes files before anything starts, which is the only moment a workspace's own
// config, agents, and commands are read from scratch.
func withSetup(fn setup) func(*settings) {
	return func(s *settings) { s.setup = append(s.setup, fn) }
}

// system is one running install: its own home, its own workspaces folder, its own port.
type system struct {
	t   *testing.T
	cfg settings

	Home          string
	WorkspacesDir string
	General       string
	Addr          string

	cmd  *exec.Cmd
	logs *syncBuffer
}

// start boots the gateway against a scratch installation and stops it when the test ends.
func start(t *testing.T, opts ...func(*settings)) *system {
	t.Helper()
	if testing.Short() {
		t.Skip("the end-to-end suite starts processes; run without -short")
	}
	if skipReason != "" {
		t.Skip(skipReason)
	}
	s := &system{t: t, logs: &syncBuffer{}}
	for _, opt := range opts {
		opt(&s.cfg)
	}
	s.Home = filepath.Join(t.TempDir(), "home")
	s.WorkspacesDir = filepath.Join(t.TempDir(), "workspaces")
	s.General = filepath.Join(t.TempDir(), "general")
	for _, dir := range []string{s.Home, s.WorkspacesDir, s.General} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	for _, fn := range s.cfg.setup {
		fn(t, s)
	}

	args := []string{
		"--home", s.Home,
		"--workspaces-dir", s.WorkspacesDir,
		"--workspace", s.General,
		"--model", "faux/faux-1",
		"--worker-dir", workerDir,
		"--addr", "127.0.0.1:0",
		"--insecure",
	}
	args = append(args, s.cfg.flags...)
	cmd := exec.Command(gatewayBin, args...)
	// A curated environment: the test must not inherit a real install's home, token, or
	// provider credentials, or it would be testing someone else's configuration.
	env := []string{"PATH=" + os.Getenv("PATH"), "HOME=" + s.Home, "ACORNFALL_HOME=" + s.Home}
	if len(s.cfg.script) > 0 {
		scriptPath := filepath.Join(s.Home, "script.json")
		payload := map[string]any{"rules": s.cfg.script}
		if s.cfg.slow {
			payload["tokensPerSecond"] = 2
		}
		encoded, err := json.MarshalIndent(payload, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(scriptPath, encoded, 0o644); err != nil {
			t.Fatal(err)
		}
		env = append(env, "ACORNFALL_DEV_SCRIPT="+scriptPath)
	} else {
		env = append(env, "ACORNFALL_DEV_PROVIDER=1")
	}
	cmd.Env = env
	cmd.Stdout = s.logs
	cmd.Stderr = s.logs
	if err := cmd.Start(); err != nil {
		t.Fatalf("start gateway: %v", err)
	}
	s.cmd = cmd
	t.Cleanup(s.stop)
	// A failure is usually explained by what the gateway and the harness said, and the
	// alternative is asking for a rerun with logging added.
	t.Cleanup(func() {
		if t.Failed() {
			t.Logf("gateway log:\n%s", s.logs.String())
		}
	})

	addr, err := s.waitForListening(30 * time.Second)
	if err != nil {
		t.Fatalf("%v\n%s", err, s.logs.String())
	}
	s.Addr = "http://" + addr
	return s
}

// waitForListening reads the startup line rather than guessing a port, so tests can bind 0
// and two runs of the suite never collide.
func (s *system) waitForListening(timeout time.Duration) (string, error) {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		for _, line := range strings.Split(s.logs.String(), "\n") {
			if at := strings.Index(line, "listening on http://"); at >= 0 {
				rest := line[at+len("listening on http://"):]
				if fields := strings.Fields(rest); len(fields) > 0 {
					return fields[0], nil
				}
			}
		}
		if s.cmd.ProcessState != nil && s.cmd.ProcessState.Exited() {
			return "", fmt.Errorf("the gateway exited before it listened")
		}
		time.Sleep(50 * time.Millisecond)
	}
	return "", fmt.Errorf("the gateway did not listen within %s", timeout)
}

func (s *system) stop() {
	if s.cmd == nil || s.cmd.Process == nil {
		return
	}
	_ = s.cmd.Process.Signal(os.Interrupt)
	done := make(chan struct{})
	go func() {
		_ = s.cmd.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(10 * time.Second):
		_ = s.cmd.Process.Kill()
		<-done
	}
}

func (s *system) workspaceDir(name string) string {
	return filepath.Join(s.WorkspacesDir, name)
}

// writeWorkspace writes a file into the general workspace, creating parents. Tests use it to
// set up the resources a workspace contributes.
func (s *system) writeWorkspace(t *testing.T, rel, content string) {
	t.Helper()
	writeFile(t, filepath.Join(s.General, rel), content)
}

func (s *system) writeHome(t *testing.T, rel, content string) {
	t.Helper()
	writeFile(t, filepath.Join(s.Home, rel), content)
}

func writeFile(t *testing.T, path, content string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatal(err)
	}
}

/* ---------- talking to it ---------- */

type client struct {
	t    *testing.T
	base string
	http *http.Client
	// stream is the same client without a timeout: a stream is meant to stay open.
	stream *http.Client
}

func (s *system) client() *client {
	return &client{
		t:      s.t,
		base:   s.Addr,
		http:   &http.Client{Timeout: 60 * time.Second},
		stream: &http.Client{},
	}
}

// watch keeps a stream open, as a client does.
//
// This is not optional politeness: the conversation list is polled only while something is
// attached, so without a subscriber a test reads a run as "not running" — the state is the
// client's view, and the client is what makes it live.
func (c *client) watch(workspace, id string) func() {
	c.t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	ready := make(chan struct{})
	go func() {
		request, err := http.NewRequestWithContext(ctx, http.MethodGet,
			fmt.Sprintf("%s/api/stream?workspace=%s&conversation=%s", c.base, workspace, id), nil)
		if err != nil {
			close(ready)
			return
		}
		response, err := c.stream.Do(request)
		if err != nil {
			close(ready)
			return
		}
		defer response.Body.Close()
		close(ready)
		_, _ = io.Copy(io.Discard, response.Body)
	}()
	<-ready
	// Give the subscription a moment to land before the test acts on it.
	time.Sleep(200 * time.Millisecond)
	return cancel
}

// do makes a request and returns the status and body. A transport failure fails the test:
// there is no case where an unreachable gateway is the expected outcome of a feature.
func (c *client) do(method, path string, body any) (int, []byte) {
	c.t.Helper()
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			c.t.Fatal(err)
		}
		reader = bytes.NewReader(encoded)
	}
	request, err := http.NewRequest(method, c.base+path, reader)
	if err != nil {
		c.t.Fatal(err)
	}
	if body != nil {
		request.Header.Set("content-type", "application/json")
	}
	response, err := c.http.Do(request)
	if err != nil {
		c.t.Fatalf("%s %s: %v", method, path, err)
	}
	defer response.Body.Close()
	payload, err := io.ReadAll(response.Body)
	if err != nil {
		c.t.Fatalf("%s %s: read body: %v", method, path, err)
	}
	return response.StatusCode, payload
}

func (c *client) get(path string, out any) {
	c.t.Helper()
	status, payload := c.do(http.MethodGet, path, nil)
	if status != http.StatusOK {
		c.t.Fatalf("GET %s: %d %s", path, status, payload)
	}
	decodeInto(c.t, path, payload, out)
}

// post accepts 202 as well as 200: sending a message is accepted rather than completed,
// because the answer arrives on the stream.
func (c *client) post(path string, body any, out any) {
	c.t.Helper()
	status, payload := c.do(http.MethodPost, path, body)
	if status != http.StatusOK && status != http.StatusAccepted {
		c.t.Fatalf("POST %s: %d %s", path, status, payload)
	}
	if out != nil {
		decodeInto(c.t, path, payload, out)
	}
}

// postStatus is for the calls where a refusal is what is being tested.
func (c *client) postStatus(path string, body any) (int, string) {
	c.t.Helper()
	status, payload := c.do(http.MethodPost, path, body)
	return status, strings.TrimSpace(string(payload))
}

func decodeInto(t *testing.T, path string, payload []byte, out any) {
	t.Helper()
	if err := json.Unmarshal(payload, out); err != nil {
		t.Fatalf("%s: decode: %v\n%s", path, err, truncate(payload, 400))
	}
}

func truncate(payload []byte, limit int) string {
	if len(payload) <= limit {
		return string(payload)
	}
	return string(payload[:limit]) + "…"
}

/* ---------- the API, as the client contract ---------- */

type conversation struct {
	ID          string  `json:"id"`
	Title       string  `json:"title"`
	Root        bool    `json:"root"`
	Hidden      bool    `json:"hidden"`
	Running     bool    `json:"running"`
	LastEntryID string  `json:"lastEntryId"`
	Tokens      float64 `json:"tokens"`
	Cost        float64 `json:"cost"`
	Parent      string  `json:"parent"`
	CreatedBy   string  `json:"createdBy"`
	Model       string  `json:"model"`
	Thinking    string  `json:"thinking"`
}

type binding struct {
	Provider          string `json:"provider"`
	ModelID           string `json:"modelId"`
	ThinkingLevel     string `json:"thinkingLevel"`
	ThinkingRequested string `json:"thinkingRequested"`
	Definition        string `json:"definition"`
}

type workspaceRef struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	Title   string `json:"title"`
	General bool   `json:"general"`
	Trusted bool   `json:"trusted"`
	Running bool   `json:"running"`
}

type providerInfo struct {
	ID            string `json:"id"`
	Authenticated bool   `json:"authenticated"`
	Models        []struct {
		ID             string   `json:"id"`
		ThinkingLevels []string `json:"thinkingLevels"`
	} `json:"models"`
}

type state struct {
	Workspace       workspaceRef      `json:"workspace"`
	Workspaces      []workspaceRef    `json:"workspaces"`
	WorkspacesDir   string            `json:"workspacesDir"`
	Conversations   []conversation    `json:"conversations"`
	Conversation    *conversation     `json:"conversation"`
	DefaultModel    binding           `json:"defaultModel"`
	DefaultThinking string            `json:"defaultThinking"`
	DefaultAgent    string            `json:"defaultAgent"`
	DefaultsOrigin  map[string]string `json:"defaultsOrigin"`
	Agent           binding           `json:"agent"`
	WorkerUp        bool              `json:"workerUp"`
	WorkerError     string            `json:"workerError"`
	Harness         string            `json:"harness"`
	Providers       []providerInfo    `json:"providers"`
	Agents          []struct {
		Name        string `json:"name"`
		Description string `json:"description"`
		Layer       string `json:"layer"`
		Source      string `json:"source"`
	} `json:"agents"`
	Skills []struct {
		Name        string `json:"name"`
		Description string `json:"description"`
	} `json:"skills"`
	Policy       map[string]any  `json:"policy"`
	Capabilities map[string]any  `json:"capabilities"`
	Defaults     []layerTrace    `json:"defaults"`
	Inherited    map[string]bool `json:"inherited"`
	Resolved     map[string]any  `json:"resolved"`
	Subagent     bool            `json:"subagent"`
}

type layerTrace struct {
	Layer       string         `json:"layer"`
	Path        string         `json:"path"`
	Contributes map[string]any `json:"contributes"`
}

func (c *client) state(workspace string) state {
	c.t.Helper()
	var out state
	c.get("/api/workspaces/"+workspace+"/state", &out)
	return out
}

func (c *client) conversationIn(workspace, id string) (conversation, bool) {
	for _, candidate := range c.state(workspace).Conversations {
		if candidate.ID == id {
			return candidate, true
		}
	}
	return conversation{}, false
}

func (c *client) prompt(workspace, id, text string) {
	c.t.Helper()
	c.post("/api/workspaces/"+workspace+"/conversations/"+id+"/messages", map[string]any{"text": text}, nil)
}

func (c *client) promptWhenBusy(workspace, id, text, when string) {
	c.t.Helper()
	c.post("/api/workspaces/"+workspace+"/conversations/"+id+"/messages",
		map[string]any{"text": text, "whenBusy": when}, nil)
}

func (c *client) create(workspace string) conversation {
	c.t.Helper()
	var out state
	c.post("/api/workspaces/"+workspace+"/conversations", nil, &out)
	if out.Conversation == nil {
		c.t.Fatalf("create in %s returned no conversation", workspace)
	}
	return *out.Conversation
}

func (c *client) createWorkspace(name string) {
	c.t.Helper()
	c.post("/api/workspaces", map[string]any{"name": name}, nil)
}

func (c *client) waitIdle(workspace, id string, timeout time.Duration) {
	c.t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if candidate, found := c.conversationIn(workspace, id); found && !candidate.Running {
			return
		}
		time.Sleep(100 * time.Millisecond)
	}
	c.t.Fatalf("%s/%s never went idle", workspace, id)
}

// waitForConversation waits until a workspace has a conversation to land on. A harness
// reports itself up as soon as its process is running, which is a moment before it has
// re-adopted the conversation it was on.
func (c *client) waitForConversation(workspace string) string {
	c.t.Helper()
	deadline := time.Now().Add(60 * time.Second)
	for time.Now().Before(deadline) {
		if got := c.state(workspace); got.Conversation != nil {
			return got.Conversation.ID
		}
		time.Sleep(100 * time.Millisecond)
	}
	c.t.Fatalf("%s never produced a conversation", workspace)
	return ""
}

// waitForConversationMatching waits for a conversation to appear in the listing. The listing
// is refreshed by a poll, so a conversation created a moment ago is not in it yet.
func (c *client) waitForConversationMatching(workspace string, predicate func(conversation) bool) conversation {
	c.t.Helper()
	deadline := time.Now().Add(60 * time.Second)
	for time.Now().Before(deadline) {
		for _, candidate := range c.state(workspace).Conversations {
			if predicate(candidate) {
				return candidate
			}
		}
		time.Sleep(200 * time.Millisecond)
	}
	c.t.Fatalf("no conversation in %s matched, listing: %+v", workspace, c.state(workspace).Conversations)
	return conversation{}
}

// waitForTitle waits for the harness to report a name, which happens with the next
// conversation listing rather than with the answer itself.
func (c *client) waitForTitle(workspace, id, prefix string) conversation {
	c.t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		if candidate, found := c.conversationIn(workspace, id); found && strings.HasPrefix(candidate.Title, prefix) {
			return candidate
		}
		time.Sleep(100 * time.Millisecond)
	}
	candidate, _ := c.conversationIn(workspace, id)
	c.t.Fatalf("%s/%s was never named %q, it is %q", workspace, id, prefix, candidate.Title)
	return candidate
}

func (c *client) waitRunning(workspace, id string, timeout time.Duration) {
	c.t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if candidate, found := c.conversationIn(workspace, id); found && candidate.Running {
			return
		}
		time.Sleep(20 * time.Millisecond)
	}
	c.t.Fatalf("%s/%s never started running", workspace, id)
}

/* ---------- the stream, which is how a transcript is read ---------- */

type block struct {
	Type      string          `json:"type"`
	Text      string          `json:"text"`
	Name      string          `json:"name"`
	Arguments json.RawMessage `json:"arguments"`
	ToolName  string          `json:"toolName"`
	IsError   bool            `json:"isError"`
}

type message struct {
	Role     string            `json:"role"`
	Content  json.RawMessage   `json:"content"`
	Sections map[string]string `json:"sections"`
}

type entry struct {
	ID       int       `json:"id"`
	Kind     string    `json:"kind"`
	Model    []message `json:"model"`
	ByTaskID int       `json:"byTaskId"`
}

type view struct {
	Conversation json.RawMessage            `json:"conversation"`
	Entries      []entry                    `json:"entries"`
	Docs         map[string]json.RawMessage `json:"docs"`
}

// text is everything the entry says, whichever shape it is in: a user message's string, an
// assistant's text and tool calls, a tool result's output.
func (e entry) text() string {
	var parts []string
	for _, m := range e.Model {
		parts = append(parts, contentText(m.Content)...)
	}
	return strings.Join(parts, "\n")
}

func contentText(raw json.RawMessage) []string {
	trimmed := bytes.TrimSpace(raw)
	if len(trimmed) == 0 || bytes.Equal(trimmed, []byte("null")) {
		return nil
	}
	if trimmed[0] == '"' {
		var text string
		if err := json.Unmarshal(trimmed, &text); err == nil {
			return []string{text}
		}
		return nil
	}
	var blocks []block
	if err := json.Unmarshal(trimmed, &blocks); err != nil {
		return nil
	}
	var parts []string
	for _, b := range blocks {
		switch b.Type {
		case "text":
			parts = append(parts, b.Text)
		case "toolCall":
			parts = append(parts, fmt.Sprintf("tool:%s%s", b.Name, string(b.Arguments)))
		}
	}
	return parts
}

func (v view) all() string {
	var parts []string
	for _, e := range v.Entries {
		parts = append(parts, e.text())
	}
	return strings.Join(parts, "\n")
}

func (v view) kinds() []string {
	kinds := make([]string, 0, len(v.Entries))
	for _, e := range v.Entries {
		kinds = append(kinds, e.Kind)
	}
	return kinds
}

// entriesOf returns the entries of one kind, oldest first.
func (v view) entriesOf(kind string) []entry {
	var found []entry
	for _, e := range v.Entries {
		if e.Kind == kind {
			found = append(found, e)
		}
	}
	return found
}

// systemSections is the prompt the model was actually sent, by section. It is how a test
// asserts what a workspace contributed without reaching inside the worker.
//
// The *newest* one: the transcript is append-only, so an earlier system entry is a record of
// what the prompt said when it was built, not of what it says now. Reading the first would
// make every change look like it had not happened.
func (v view) systemSections() map[string]string {
	for index := len(v.Entries) - 1; index >= 0; index-- {
		e := v.Entries[index]
		if e.Kind != "pi.system" {
			continue
		}
		for _, m := range e.Model {
			if len(m.Sections) > 0 {
				return m.Sections
			}
		}
	}
	return nil
}

// lastToolResult is the newest tool result, for the same reason as systemSections.
func (v view) lastToolResult() string {
	results := v.toolResults()
	if len(results) == 0 {
		return ""
	}
	return results[len(results)-1]
}

func (v view) toolResults() []string {
	var results []string
	for _, e := range v.Entries {
		if e.Kind == "pi.tool-result" {
			results = append(results, e.text())
		}
	}
	return results
}

// waitView reads the event stream until a view of the conversation satisfies the predicate.
// A view is the whole transcript, so this is waiting for the run to have happened, not for a
// frame to appear; the stream is exactly what a client sees.
func (c *client) waitView(workspace, id string, predicate func(view) bool, timeout time.Duration) view {
	c.t.Helper()
	deadline := time.Now().Add(timeout)
	var last view
	// Reconnects until the deadline, because a client does: the stream closes while a harness
	// is being replaced, and a test that treated that as final would fail for the wrong reason.
	for attempt := 0; time.Now().Before(deadline); attempt++ {
		request, err := http.NewRequest(http.MethodGet,
			fmt.Sprintf("%s/api/stream?workspace=%s&conversation=%s", c.base, workspace, id), nil)
		if err != nil {
			c.t.Fatal(err)
		}
		ctx, cancel := context.WithDeadline(context.Background(), deadline)
		response, err := c.http.Do(request.WithContext(ctx))
		if err != nil {
			cancel()
			time.Sleep(200 * time.Millisecond)
			continue
		}
		scanner := bufio.NewScanner(response.Body)
		scanner.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)
		event, data := "", ""
		found := view{}
		for scanner.Scan() {
			line := scanner.Text()
			switch {
			case strings.HasPrefix(line, "event: "):
				event = strings.TrimPrefix(line, "event: ")
			case strings.HasPrefix(line, "data: "):
				data = strings.TrimPrefix(line, "data: ")
			case line == "":
				if event == "frame" && data != "" {
					var frame struct {
						Type           string `json:"type"`
						ConversationID string `json:"conversationId"`
						Value          view   `json:"value"`
					}
					if err := json.Unmarshal([]byte(data), &frame); err == nil && frame.Type == "view" && frame.ConversationID == id {
						last = frame.Value
						if predicate(frame.Value) {
							response.Body.Close()
							cancel()
							return frame.Value
						}
					}
				}
				event, data = "", ""
			}
		}
		response.Body.Close()
		cancel()
		_ = found
		time.Sleep(200 * time.Millisecond)
	}
	c.t.Fatalf("the stream ended before %s/%s showed what was expected\nlast transcript:\n%s",
		workspace, id, last.all())
	return last
}

// view waits for any transcript at all, which is what a test wants when it only cares that
// the conversation it just created is readable.
func (c *client) view(workspace, id string) view {
	c.t.Helper()
	return c.waitView(workspace, id, func(v view) bool { return true }, 30*time.Second)
}

func (c *client) waitForText(workspace, id, want string) view {
	c.t.Helper()
	return c.waitView(workspace, id, func(v view) bool { return strings.Contains(v.all(), want) }, 60*time.Second)
}

// streamEvents collects the named events seen within a window, for the checks that are about
// the stream itself.
func (c *client) streamEvents(workspace, id string, window time.Duration) map[string]int {
	c.t.Helper()
	request, err := http.NewRequest(http.MethodGet,
		fmt.Sprintf("%s/api/stream?workspace=%s&conversation=%s", c.base, workspace, id), nil)
	if err != nil {
		c.t.Fatal(err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), window)
	defer cancel()
	response, err := c.http.Do(request.WithContext(ctx))
	// Running out of time is how this helper ends: the window is the whole point.
	if err != nil && !errors.Is(err, context.DeadlineExceeded) {
		c.t.Fatalf("stream: %v", err)
	}
	if response == nil {
		c.t.Fatal("stream: no response")
	}
	defer response.Body.Close()
	counts := map[string]int{}
	scanner := bufio.NewScanner(response.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)
	for scanner.Scan() {
		if strings.HasPrefix(scanner.Text(), "event: ") {
			counts[strings.TrimPrefix(scanner.Text(), "event: ")]++
		}
	}
	return counts
}

/* ---------- small utilities ---------- */

type syncBuffer struct {
	mu  sync.Mutex
	buf bytes.Buffer
}

func (b *syncBuffer) Write(p []byte) (int, error) {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.Write(p)
}

func (b *syncBuffer) String() string {
	b.mu.Lock()
	defer b.mu.Unlock()
	return b.buf.String()
}

// freePort is only for the tests that cannot read a startup line: the auth test binds a
// non-loopback address and therefore cannot use the loopback default.
func freePort(t *testing.T) int {
	t.Helper()
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	return listener.Addr().(*net.TCPAddr).Port
}
