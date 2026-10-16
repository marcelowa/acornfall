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
	"flag"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/acornfall/acornfall/gateway/internal/sandbox"
)

var (
	repoRoot   string
	gatewayBin string
	workerDir  string
	skipReason string
	// engineHome is a shared installation of the sandbox engine for the whole run. Every test
	// gets a fresh home, and a fresh home installs 26MB on first use; on a CI runner that
	// download took 28 seconds, and four tests doing it at once raced the 30-second startup
	// wait. The engine is the same release for every test, so it is fetched once and linked.
	engineHome string
)

func TestMain(m *testing.M) {
	// The testing flags are parsed here because testing.Short is read below and panics before
	// Parse; m.Run parses them again, which is the documented TestMain shape.
	flag.Parse()
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
	}
	if skipReason == "" {
		if _, err := os.Stat(filepath.Join(workerDir, "node_modules", "@earendil-works")); err != nil {
			skipReason = "worker dependencies are not installed (make deps)"
		}
	}

	if skipReason == "" {
		dir, err := os.MkdirTemp("", "acornfall-e2e-*")
		if err != nil {
			panic(err)
		}
		gatewayBin = filepath.Join(dir, "acornfall")
		// Removed explicitly rather than deferred: `os.Exit` skips defers, which is how every
		// run of this suite left a temp directory holding a built binary behind.

		args := []string{"build"}
		if raceEnabled {
			args = append(args, "-race")
		}
		args = append(args, "-o", gatewayBin, "./cmd/acornfall")
		build := exec.Command("go", args...)
		build.Dir = filepath.Join(repoRoot, "gateway")
		if out, err := build.CombinedOutput(); err != nil {
			panic(fmt.Sprintf("build gateway: %v\n%s", err, out))
		}
		// One install for the suite, but only when a sandbox can run and the tier is going to
		// ask for one: the fast tier's host-engine tests never touch the microVM engine.
		if !testing.Short() && sandboxUnavailable() == "" {
			shared := filepath.Join(dir, "engine")
			if err := sandbox.NewMicrosandbox(shared).Install(context.Background(), nil); err != nil {
				engineHome = ""
			} else {
				engineHome = shared
			}
		}
	}
	code := m.Run()
	if gatewayBin != "" {
		_ = os.RemoveAll(filepath.Dir(gatewayBin))
	}
	os.Exit(code)
}

func which(name string) string {
	path, err := exec.LookPath(name)
	if err != nil {
		return ""
	}
	return path
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
	setup  []setup
	// noDevProvider runs the worker as a fresh production install does: the real
	// providers, none of which authenticate in the curated test environment, and no
	// --model flag to guess from.
	noDevProvider bool
}

// withScript is what the model does: the first rule whose Match is a substring of the last
// user message wins, its tools are called, and then its Reply is the answer.
func withScript(rules ...scriptRule) func(*settings) {
	return func(s *settings) { s.script = rules }
}

// slowTokensPerSecond is the pace withSlowModel asks for. It has to be slow enough that a
// turn is still running when the test acts — aborting, steering, killing the worker — and
// fast enough that the suite does not spend five to fifteen seconds per test waiting for
// scripted tokens: at 2/s these three tests were 33 of the 52 seconds the suite spent. 20/s
// leaves about a second of stream for a reply this size, and the tests act within
// milliseconds of the run appearing.
const slowTokensPerSecond = 20

// withSlowModel streams slowly enough that a turn is still running while the test acts.
func withSlowModel() func(*settings) {
	return func(s *settings) { s.slow = true }
}

// withSetup writes files before anything starts, which is the only moment a workspace's own
// config, agents, and commands are read from scratch.
func withSetup(fn setup) func(*settings) {
	return func(s *settings) { s.setup = append(s.setup, fn) }
}

// withoutDevProvider runs the install as a fresh production one does: the real providers,
// none of which authenticate in the curated test environment, and no --model flag to guess
// from. Selecting must still land — "no authenticated provider" is a state, not a failure —
// and only sending says a provider is needed.
func withoutDevProvider() func(*settings) {
	return func(s *settings) { s.noDevProvider = true }
}

// system is one running install: its own home, its own workspaces folder, its own port.
type system struct {
	t   *testing.T
	cfg settings

	Home          string
	WorkspacesDir string
	General       string
	Addr          string
	// SandboxState is shared by every test in this package: the image the sandboxes boot from
	// is fetched once, so the suite does not pull it thirty times and hit a registry's
	// anonymous rate limit.
	SandboxState string

	cmd  *exec.Cmd
	logs *syncBuffer
}

// start boots the gateway against a scratch installation and stops it when the test ends.
func start(t *testing.T, opts ...func(*settings)) *system {
	t.Helper()
	if skipReason != "" {
		t.Skip(skipReason)
	}
	s := &system{t: t, logs: &syncBuffer{}}
	for _, opt := range opts {
		opt(&s.cfg)
	}
	// The installation folder has to be short: the sandbox engine's runtime sockets live under
	// it and a Unix socket path is limited to 108 bytes, most of which the engine's own layout
	// uses. A test's name is long, so the home is made here rather than under it.
	shortRoot := filepath.Join(os.TempDir(), fmt.Sprintf("af-%d", os.Getpid()))
	if err := os.MkdirAll(shortRoot, 0o755); err != nil {
		t.Fatal(err)
	}
	shortHome, err := os.MkdirTemp(shortRoot, "home")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		// The sandboxes this test created are stopped here: the gateway is killed, so its
		// control never closes, and a leftover microVM holds memory for its idle timeout.
		// Only this test's workspaces are named: removing by the acornfall label took every
		// sandbox in the shared state, including a parallel test's running VM. The shared
		// state directory stays: it holds the downloaded image every test would otherwise
		// fetch again, which is also how a suite avoids a registry's rate limit.
		if keepSandboxes() {
			return
		}
		if bin := engineBinary(shortHome); bin != "" {
			for _, name := range s.sandboxesOwnedByTest() {
				cmd := exec.Command(bin, "rm", "--force", name)
				cmd.Env = append(os.Environ(), "MSB_HOME="+s.SandboxState)
				_ = cmd.Run()
			}
		}
		os.RemoveAll(shortHome)
	})
	s.Home = shortHome
	// A stable path, not a per-run one: it holds the image every sandbox boots from, and a
	// fresh directory per run means a registry pull per run — which is how a suite runs into
	// an anonymous pull limit. The sandboxes themselves are removed by the tests that made
	// them, when they end.
	s.SandboxState = filepath.Join(os.TempDir(), "acornfall-e2e-sandboxes")
	s.WorkspacesDir = filepath.Join(t.TempDir(), "workspaces")
	s.General = filepath.Join(t.TempDir(), "general")
	for _, dir := range []string{s.Home, s.WorkspacesDir, s.General} {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			t.Fatal(err)
		}
	}
	// The shared engine, linked where a driver looks for it, so the first workspace to start
	// does not pay for a download per test. A host-engine test never touches this driver.
	if _, host := hostEngineTests.Load(t.Name()); engineHome != "" && !host {
		if err := os.MkdirAll(filepath.Join(s.Home, "tools"), 0o755); err != nil {
			t.Fatal(err)
		}
		link := filepath.Join(s.Home, "tools", "microsandbox")
		_ = os.RemoveAll(link)
		if err := os.Symlink(filepath.Join(engineHome, "tools", "microsandbox"), link); err != nil {
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
		"--worker-dir", workerDir,
		"--addr", "127.0.0.1:0",
		"--insecure",
	}
	// A fresh install has no model flag: the last resort is derived, not given. Every other
	// test runs with one, so a prompt always has something to run without credentials.
	if !s.cfg.noDevProvider {
		args = append(args, "--model", "faux/faux-1")
	}
	// A resource test runs on the host engine: it needs the workspace's files, not a microVM,
	// and this is the engine that needs no hypervisor and no state directory. Everything else
	// runs with the sandbox tier forced off, which is a refusal path and not a host fallback.
	hostEngine := false
	if value, ok := hostEngineTests.Load(t.Name()); ok && value == true {
		hostEngine = true
		args = append(args, "--sandbox-engine", "host")
	} else {
		args = append(args, "--sandbox-state", s.SandboxState)
	}
	cmd := exec.Command(gatewayBin, args...)
	// A curated environment: the test must not inherit a real install's home, token, or
	// provider credentials, or it would be testing someone else's configuration. The
	// switches that decide how this install behaves are forwarded explicitly.
	env := []string{"PATH=" + os.Getenv("PATH"), "HOME=" + s.Home, "ACORNFALL_HOME=" + s.Home}
	if noSandbox := os.Getenv("ACORNFALL_NO_SANDBOX"); noSandbox != "" && !hostEngine {
		env = append(env, "ACORNFALL_NO_SANDBOX="+noSandbox)
	}
	if len(s.cfg.script) > 0 {
		scriptPath := filepath.Join(s.Home, "script.json")
		payload := map[string]any{"rules": s.cfg.script}
		if s.cfg.slow {
			payload["tokensPerSecond"] = slowTokensPerSecond
		}
		encoded, err := json.MarshalIndent(payload, "", "  ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(scriptPath, encoded, 0o644); err != nil {
			t.Fatal(err)
		}
		env = append(env, "ACORNFALL_DEV_SCRIPT="+scriptPath)
	} else if !s.cfg.noDevProvider {
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

	addr, err := s.waitForListening(90 * time.Second)
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
		for line := range strings.SplitSeq(s.logs.String(), "\n") {
			if _, after, ok := strings.Cut(line, "listening on http://"); ok {
				rest := after
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

// sandboxesOwnedByTest lists the sandboxes this test is allowed to remove: the general
// workspace, and every workspace created by name inside this test's own workspaces folder.
// A test owns what it created, and the workspaces folder is a per-test temp directory, so
// nothing here can name another test's sandbox. Removing by the acornfall label instead took
// every sandbox in the shared state, which is what made a parallel sandbox run fail in a
// different set of tests each time.
func (s *system) sandboxesOwnedByTest() []string {
	paths := []string{s.General}
	if matches, err := filepath.Glob(filepath.Join(s.WorkspacesDir, "*")); err == nil {
		paths = append(paths, matches...)
	}
	names := make([]string, 0, len(paths))
	for _, path := range paths {
		names = append(names, sandbox.Name(path))
	}
	return names
}

// keepSandboxes leaves the sandboxes a test made in place, which is what somebody debugging a
// sandbox failure wants: the machine is then still there to look at.
func keepSandboxes() bool {
	return os.Getenv("ACORNFALL_KEEP_SANDBOXES") != ""
}

// engineBinary finds the installed engine under a home, whatever version it is.
func engineBinary(home string) string {
	matches, err := filepath.Glob(filepath.Join(home, "tools", "microsandbox", "*", "bin", "msb"))
	if err != nil || len(matches) == 0 {
		return ""
	}
	return matches[0]
}

// hostEngineTests records the tests that asked for a workspace but not a real sandbox. start
// reads it and runs their gateway with --sandbox-engine host, which needs no hypervisor and
// no state directory; a test declares it in workspaceResources, before start.
var hostEngineTests sync.Map

// notSandbox marks a test that needs no real workspace. Both sandbox tiers skip it: this one
// already ran in the fast tier, where the tools take the refusal path. Without a marker a
// test that never asked for a sandbox still boots one there, because starting a workspace's
// worker provisions its sandbox.
func notSandbox(t *testing.T) {
	t.Helper()
	if os.Getenv("ACORNFALL_SANDBOX_ONLY") != "" {
		t.Skip("this test needs no sandbox; the fast tier ran it against the refusal path")
	}
}

// maybeSandbox marks a test that exercises the sandbox itself: a command runs through it, a
// file operation goes through it, or the mounts are asserted. `make test-sandbox` runs these
// on the microVM engine; the fast tier skips them under -short.
func maybeSandbox(t *testing.T) {
	t.Helper()
	if testing.Short() {
		t.Skip("this test needs a sandbox; make test-sandbox runs it")
	}
	skipWithoutHypervisor(t)
}

// workspaceResources marks a test whose subject is the resource overlay — rules, definitions,
// commands, skills — and whose files live in the workspace. The worker reads those only
// through an engine (ADR 0012: it has no host path to the workspace), so the test cannot run
// with the tools refusing; it runs on the host engine, which needs no hypervisor and works on
// every machine, including CI. The microVM path is covered by the boundary tests.
func workspaceResources(t *testing.T) {
	t.Helper()
	if os.Getenv("ACORNFALL_SANDBOX_ONLY") != "" {
		t.Skip("the sandbox tier runs the boundary tests; this one is a resource test")
	}
	hostEngineTests.Store(t.Name(), true)
}

// skipWithoutHypervisor is the machine check both sandbox tiers share: the engine refuses to
// run tools where there is none, which is the behaviour ADR 0012 asks for, so the test skips
// rather than pretending.
func skipWithoutHypervisor(t *testing.T) {
	t.Helper()
	if reason := sandboxUnavailable(); reason != "" {
		t.Skipf("this machine cannot run a sandbox: %s", reason)
	}
}

// sandboxUnavailable is the cheap version of the engine's own check: enough to decide whether
// a test can run, without starting an engine to ask it.
func sandboxUnavailable() string {
	// CI has no /dev/kvm, and nobody wants to think about which tests skip there: this makes
	// it a switch, so the CI behaviour can be run deliberately on a machine that has one.
	if os.Getenv("ACORNFALL_NO_SANDBOX") != "" {
		return "ACORNFALL_NO_SANDBOX is set"
	}
	switch runtime.GOOS {
	case "linux":
		file, err := os.OpenFile("/dev/kvm", os.O_RDWR, 0)
		if err != nil {
			return "/dev/kvm is not usable: " + err.Error()
		}
		file.Close()
		return ""
	case "darwin":
		out, err := exec.Command("sysctl", "-n", "kern.hv_support").Output()
		if err != nil || strings.TrimSpace(string(out)) != "1" {
			return "macOS reports no hypervisor support"
		}
		return ""
	default:
		return "no hypervisor for " + runtime.GOOS
	}
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
	status, payload, err := c.doTry(method, path, body)
	if err != nil {
		c.t.Fatalf("%s %s: %v", method, path, err)
	}
	return status, payload
}

// doTry is do without the failure: a polling wait treats a slow gateway as a reason to
// try again, not as the verdict. A single GET that takes the client's whole minute on a
// loaded -race runner used to fail the test it was polling for, even though the next
// poll would have answered — PR #37 and main a38c6cc both fell this way, waiting for a
// peer/child listing while the gateway was busy starting it.
func (c *client) doTry(method, path string, body any) (int, []byte, error) {
	c.t.Helper()
	var reader io.Reader
	if body != nil {
		encoded, err := json.Marshal(body)
		if err != nil {
			return 0, nil, err
		}
		reader = bytes.NewReader(encoded)
	}
	request, err := http.NewRequest(method, c.base+path, reader)
	if err != nil {
		return 0, nil, err
	}
	if body != nil {
		request.Header.Set("content-type", "application/json")
	}
	response, err := c.http.Do(request)
	if err != nil {
		return 0, nil, err
	}
	defer response.Body.Close()
	payload, err := io.ReadAll(response.Body)
	if err != nil {
		return 0, nil, fmt.Errorf("read body: %w", err)
	}
	return response.StatusCode, payload, nil
}

func (c *client) get(path string, out any) {
	c.t.Helper()
	if err := c.getTry(path, out); err != nil {
		c.t.Fatalf("GET %s: %v", path, err)
	}
}

// getTry is get without the failure, for the same reason as doTry: polling waits retry.
func (c *client) getTry(path string, out any) error {
	c.t.Helper()
	status, payload, err := c.doTry(http.MethodGet, path, nil)
	if err != nil {
		return err
	}
	if status != http.StatusOK {
		return fmt.Errorf("%d %s", status, truncate(payload, 200))
	}
	if err := json.Unmarshal(payload, out); err != nil {
		return fmt.Errorf("decode: %w", err)
	}
	return nil
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
	UpdatedAt   int64   `json:"updatedAt"`
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
	Running bool   `json:"running"`
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
	Capabilities map[string]any `json:"capabilities"`
	Sandbox      struct {
		Engine   string `json:"engine"`
		Version  string `json:"version"`
		Status   string `json:"status"`
		Tools    bool   `json:"tools"`
		Isolated bool   `json:"isolated"`
		Problem  string `json:"problem"`
	} `json:"sandbox"`
	Defaults []layerTrace   `json:"defaults"`
	Resolved map[string]any `json:"resolved"`
	Draft    *draft         `json:"draft"`
}

// draft is one room's unsent message, as the state carries it.
type draft struct {
	Text        string `json:"text"`
	UpdatedAt   int64  `json:"updatedAt"`
	Attachments []struct {
		ID   string `json:"id"`
		Name string `json:"name"`
		Size int64  `json:"size"`
		MIME string `json:"mime"`
	} `json:"attachments"`
}

type layerTrace struct {
	Layer string `json:"layer"`
	Path  string `json:"path"`
}

// saveDraft is the composer's own write: the unsent message of one room.
func (c *client) saveDraft(workspace, id, text string) {
	c.t.Helper()
	c.post(c.conversationPath(workspace, id)+"/draft", map[string]any{"text": text}, nil)
}

// draftIn reads one room's draft, whatever conversation the install happens to be on.
func (c *client) draftIn(workspace, id string) *draft {
	c.t.Helper()
	var out state
	c.get("/api/workspaces/"+workspace+"/state?conversation="+id, &out)
	return out.Draft
}

func (c *client) state(workspace string) state {
	c.t.Helper()
	out, err := c.stateTry(workspace)
	if err != nil {
		c.t.Fatalf("GET /api/workspaces/%s/state: %v", workspace, err)
	}
	return out
}

func (c *client) stateTry(workspace string) (state, error) {
	c.t.Helper()
	var out state
	if err := c.getTry("/api/workspaces/"+workspace+"/state", &out); err != nil {
		return state{}, err
	}
	return out, nil
}

// conversations is the listing the server refreshes before answering, unlike the state, which
// is the cached view a watching client is pushed. A test that reads something the harness
// reports only on commit wants this one.
func (c *client) conversations(workspace string) []conversation {
	c.t.Helper()
	out, err := c.conversationsTry(workspace)
	if err != nil {
		c.t.Fatalf("GET /api/workspaces/%s/conversations: %v", workspace, err)
	}
	return out
}

func (c *client) conversationsTry(workspace string) ([]conversation, error) {
	c.t.Helper()
	var out []conversation
	if err := c.getTry("/api/workspaces/"+workspace+"/conversations", &out); err != nil {
		return nil, err
	}
	return out, nil
}

func (c *client) conversationIn(workspace, id string) (conversation, bool) {
	candidate, found, err := c.conversationInTry(workspace, id)
	if err != nil {
		c.t.Fatalf("GET /api/workspaces/%s/state: %v", workspace, err)
	}
	return candidate, found
}

func (c *client) conversationInTry(workspace, id string) (conversation, bool, error) {
	got, err := c.stateTry(workspace)
	if err != nil {
		return conversation{}, false, err
	}
	for _, candidate := range got.Conversations {
		if candidate.ID == id {
			return candidate, true, nil
		}
	}
	return conversation{}, false, nil
}

// conversationPath is the collection, or one conversation when an id is given. The actions on
// a conversation are named after what they do, so a test reads as the call it is making.
func (c *client) conversationPath(workspace, id string) string {
	path := "/api/workspaces/" + workspace + "/conversations"
	if id == "" {
		return path
	}
	return path + "/" + id
}

func (c *client) prompt(workspace, id, text string) {
	c.t.Helper()
	c.post(c.conversationPath(workspace, id)+"/messages", map[string]any{"text": text}, nil)
}

func (c *client) promptWhenBusy(workspace, id, text, when string) {
	c.t.Helper()
	c.post(c.conversationPath(workspace, id)+"/messages", map[string]any{"text": text, "whenBusy": when}, nil)
}

func (c *client) create(workspace string) conversation {
	c.t.Helper()
	var out state
	c.post(c.conversationPath(workspace, ""), nil, &out)
	if out.Conversation == nil {
		c.t.Fatalf("create in %s returned no conversation", workspace)
	}
	return *out.Conversation
}

func (c *client) rename(workspace, id, title string) {
	c.t.Helper()
	c.post(c.conversationPath(workspace, id)+"/rename", map[string]any{"title": title}, nil)
}

func (c *client) hide(workspace, id string, hidden bool) {
	c.t.Helper()
	c.post(c.conversationPath(workspace, id)+"/hide", map[string]any{"hidden": hidden}, nil)
}

// compact starts a manual compaction and hands back the state it left.
func (c *client) compact(workspace, id string) {
	c.t.Helper()
	var out state
	c.post(c.conversationPath(workspace, id)+"/compact", map[string]any{}, &out)
	if out.Conversation == nil {
		c.t.Fatalf("compact of %s/%s returned no conversation", workspace, id)
	}
}

// compactPreview asks what a manual compaction would fold: turn and entry counts.
func (c *client) compactPreview(workspace, id string) map[string]any {
	c.t.Helper()
	out := map[string]any{}
	c.post(c.conversationPath(workspace, id)+"/compact-preview", map[string]any{}, &out)
	return out
}

// fork branches before the turn the entry begins, and hands back the conversation it made.
func (c *client) fork(workspace, id, at string) conversation {
	c.t.Helper()
	var out state
	c.post(c.conversationPath(workspace, id)+"/fork", map[string]any{"at": at}, &out)
	if out.Conversation == nil {
		c.t.Fatalf("fork of %s/%s returned no conversation", workspace, id)
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
		// A slow poll is a retry, not a verdict: see doTry.
		listed, err := c.conversationsTry(workspace)
		if err != nil {
			time.Sleep(200 * time.Millisecond)
			continue
		}
		for _, candidate := range listed {
			if candidate.ID == id && !candidate.Running {
				return
			}
		}
		time.Sleep(50 * time.Millisecond)
	}
	c.t.Fatalf("%s/%s never went idle", workspace, id)
}

// waitForConversation waits until a workspace has a conversation to land on. A harness
// reports itself up as soon as its process is running, which is a moment before it has
// re-adopted the conversation it was on.
func (c *client) waitForConversation(workspace string) string {
	c.t.Helper()
	// Two minutes, not one: the timeout is a bound for a failing test, not a target, and the
	// CI runners are several times slower than a development machine — a scripted answer that
	// takes a second here can take a minute there, and a deadline that a slow machine cannot
	// meet is a test that fails for the wrong reason.
	deadline := time.Now().Add(2 * time.Minute)
	for time.Now().Before(deadline) {
		if got, err := c.stateTry(workspace); err == nil && got.Conversation != nil {
			return got.Conversation.ID
		}
		time.Sleep(100 * time.Millisecond)
	}
	c.t.Fatalf("%s never produced a conversation", workspace)
	return ""
}

// waitForConversationMatching waits for a conversation to appear in the listing.
//
// The listing it asks is the one the server refreshes before answering, not the cached view the
// state carries: the cache is kept current by a poll that runs only while a client is attached,
// so a test that has just closed its stream would wait for a tick that never comes. A
// conversation created a moment ago is therefore always in this one.
func (c *client) waitForConversationMatching(workspace string, predicate func(conversation) bool) conversation {
	c.t.Helper()
	deadline := time.Now().Add(2 * time.Minute)
	for time.Now().Before(deadline) {
		listed, err := c.conversationsTry(workspace)
		if err != nil {
			time.Sleep(200 * time.Millisecond)
			continue
		}
		for _, candidate := range listed {
			if predicate(candidate) {
				return candidate
			}
		}
		time.Sleep(200 * time.Millisecond)
	}
	listed, err := c.conversationsTry(workspace)
	if err != nil {
		c.t.Fatalf("no conversation in %s matched: last listing failed: %v", workspace, err)
	}
	c.t.Fatalf("no conversation in %s matched, listing: %+v", workspace, listed)
	return conversation{}
}

// waitForTitle waits for the harness to report a name, which happens with the next
// conversation listing rather than with the answer itself.
func (c *client) waitForTitle(workspace, id, prefix string) conversation {
	c.t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		if candidate, found, err := c.conversationInTry(workspace, id); err == nil && found && strings.HasPrefix(candidate.Title, prefix) {
			return candidate
		}
		time.Sleep(100 * time.Millisecond)
	}
	candidate, _, _ := c.conversationInTry(workspace, id)
	c.t.Fatalf("%s/%s was never named %q, it is %q", workspace, id, prefix, candidate.Title)
	return candidate
}

// waitRunning waits until the worker reports the conversation as running. It asks the
// refreshed listing, not the cached state: the state is kept current by a 3-second poll that
// runs only while a client is attached, so a turn that finishes inside that window is never
// seen as running at all — with a fast scripted model the three tests that act on a live run
// waited 30 seconds and failed on "never started running". The listing asks the worker.
func (c *client) waitRunning(workspace, id string, timeout time.Duration) {
	c.t.Helper()
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		listed, err := c.conversationsTry(workspace)
		if err != nil {
			time.Sleep(100 * time.Millisecond)
			continue
		}
		for _, candidate := range listed {
			if candidate.ID == id && candidate.Running {
				return
			}
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
}

type message struct {
	Content  json.RawMessage   `json:"content"`
	Sections map[string]string `json:"sections"`
}

type entry struct {
	ID    int            `json:"id"`
	Kind  string         `json:"kind"`
	Model []message      `json:"model"`
	Data  map[string]any `json:"data"`
}

type view struct {
	Entries []entry `json:"entries"`
}

// text is everything the entry says, whichever shape it is in: a user message's string, an
// assistant's text and tool calls, a tool result's output.
func (e entry) text() string {
	var parts []string
	for _, m := range e.Model {
		parts = append(parts, contentText(m.Content)...)
	}
	// Display-only entries carry no model messages: their text lives in data.
	if notice, ok := e.Data["text"].(string); ok {
		parts = append(parts, notice)
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
	for _, e := range slices.Backward(v.Entries) {
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
	for time.Now().Before(deadline) {
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
	return c.waitView(workspace, id, func(v view) bool { return strings.Contains(v.all(), want) }, 2*time.Minute)
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
	counts := map[string]int{}
	response, err := c.http.Do(request.WithContext(ctx))
	// Running out of time is how this helper ends: the window is the whole point. A deadline
	// before the first byte leaves nothing to read, which the caller sees as no events.
	if err != nil {
		if !errors.Is(err, context.DeadlineExceeded) {
			c.t.Fatalf("stream: %v", err)
		}
		return counts
	}
	defer response.Body.Close()
	scanner := bufio.NewScanner(response.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)
	for scanner.Scan() {
		if after, ok := strings.CutPrefix(scanner.Text(), "event: "); ok {
			counts[after]++
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
