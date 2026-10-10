// Package control owns the domain: the workspace, its conversations, agent
// bindings, provider credentials, worker lifecycle, and the fan-out of worker
// frames to attached clients.
//
// A conversation id is the harness's own id, stringified, and is opaque here.
// See docs/adr/0005-multi-conversation.md.
package control

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/acornfall/acornfall/gateway/internal/protocol"
	"github.com/acornfall/acornfall/gateway/internal/sandbox"
	"github.com/acornfall/acornfall/gateway/internal/workerpool"
)

// ErrNoProvider means the install has no usable credential yet. It is a state,
// not a failure: the UI has to be reachable so the user can connect one.
var ErrNoProvider = errors.New("no authenticated provider")

// Options configures one Control instance, which owns exactly one workspace.
type Options struct {
	// Workspace is the folder and name this Control serves.
	Workspace Workspace
	// Home is the installation folder: global resources and shared credentials.
	Home string
	// UserHome is the user's home folder, for `~/.agents`, which a sandbox mounts read-only
	// beside the install's own resource folders. The entry point resolves it and fails when it
	// cannot, so a control always has one.
	UserHome string
	// StoragePath is this workspace's durable storage. One storage per workspace, because
	// conversation ids are only unique inside one.
	StoragePath string
	// WorkerCommand is the base command; the per-workspace flags are appended in here.
	WorkerCommand []string
	WorkerDir     string
	Credentials   string
	// Model is the "provider/modelId" to use as the workspace default. It wins over a
	// persisted default, and every conversation that never chose a model follows it.
	Model string
	// SettingsPath persists the active conversation and per-conversation agents.
	SettingsPath string
	// Registry lists the install's workspaces, so a client can switch between them.
	Registry func() []Workspace
	// WorkspacesDir is where new workspaces are created, so the interface can say so.
	WorkspacesDir string
	// Sandbox is the machine's sandbox tier. Nil means this Control was built without one,
	// which is what ACORNFALL_NO_SANDBOX asks the gateway for: the workspace still opens and
	// its tools refuse.
	Sandbox *sandbox.Manager
	// DisableVMNesting is the install default for nesting, from --disable-vm-nesting. A
	// workspace's own setting wins over it, and the engine and the machine have the last
	// word: see docs/adr/0018-disable-vm-nesting.md.
	DisableVMNesting bool
}

// SandboxState says what the agent's tools can reach here. When Tools is false the tools
// refuse rather than running on the host, and Problem says why, because a silent fallback
// would be worse than a refusal. Isolated says whether the engine separates a command from
// the host: false is the host engine, and the interface has to be able to say so.
type SandboxState struct {
	Engine   string `json:"engine,omitempty"`
	Version  string `json:"version,omitempty"`
	Status   string `json:"status,omitempty"`
	Tools    bool   `json:"tools"`
	Isolated bool   `json:"isolated"`
	Problem  string `json:"problem,omitempty"`
	// Nested says the next sandbox will nest: nesting was not disabled and the machine can
	// grant it — like an image change, nesting applies when a sandbox is created.
	// NestedReason says why not when a workspace that allows nesting cannot get it, so it
	// is visible rather than a surprise. A workspace that disables nesting carries neither.
	Nested       bool   `json:"nested,omitempty"`
	NestedReason string `json:"nestedReason,omitempty"`
}

// WorkspaceState is a workspace as the interface needs it: what it is called, where it
// points, and whether its worker is running.
type WorkspaceState struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	Title   string `json:"title"`
	General bool   `json:"general"`
	Image   string `json:"image,omitempty"`
	Network string `json:"network,omitempty"`
	// DisableVMNesting is nil when this workspace follows the install's --disable-vm-nesting,
	// and a choice of its own otherwise. True refuses nesting; absent or false allows it
	// wherever the engine and the machine can.
	DisableVMNesting *bool `json:"disable_vm_nesting,omitempty"`
	Running          bool  `json:"running"`
}

// Inherited reports which fields the active conversation left to the defaults.
type Inherited struct {
	Model    bool `json:"model"`
	Thinking bool `json:"thinking"`
	Agent    bool `json:"agent"`
}

// Conversation is one transcript, as the UI lists it.
type Conversation struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Root  bool   `json:"root"`
	// Hidden conversations are tombstoned, not deleted; the UI can restore them.
	Hidden bool `json:"hidden"`
	// Running, LastEntryID, UpdatedAt, Tokens, and Cost are live state for the rail.
	Running     bool   `json:"running"`
	LastEntryID string `json:"lastEntryId"`
	// UpdatedAt is last activity, Unix milliseconds, so the rail can group by date.
	// Zero when the conversation has no entries yet, which renders flat.
	UpdatedAt int64   `json:"updatedAt,omitempty"`
	Tokens    float64 `json:"tokens"`
	Cost      float64 `json:"cost"`
	// Parent marks a subagent conversation: created by another conversation.
	Parent   string   `json:"parent,omitempty"`
	Children []string `json:"children,omitempty"`
	Model    string   `json:"model,omitempty"`
	Thinking string   `json:"thinking,omitempty"`
	// CreatedBy marks a peer: a normal conversation an agent created.
	CreatedBy string `json:"createdBy,omitempty"`
}

// State is everything the UI needs to render before any frame arrives.
type State struct {
	Workspace     WorkspaceState          `json:"workspace"`
	Workspaces    []WorkspaceState        `json:"workspaces"`
	WorkspacesDir string                  `json:"workspacesDir"`
	Harness       string                  `json:"harness"`
	Capabilities  protocol.Capabilities   `json:"capabilities"`
	Conversation  *Conversation           `json:"conversation,omitempty"`
	Conversations []Conversation          `json:"conversations"`
	Agent         protocol.ModelBinding   `json:"agent"`
	Resolved      *protocol.ResolvedAgent `json:"resolved,omitempty"`
	// Defaults apply to conversations that never chose, and to new ones. They are resolved
	// across the layers, so what is here is what will run; the origin says which layer gave
	// each one, so the interface can explain rather than just state it.
	DefaultModel    protocol.ModelBinding `json:"defaultModel"`
	DefaultThinking string                `json:"defaultThinking"`
	DefaultAgent    string                `json:"defaultAgent"`
	DefaultsOrigin  DefaultOrigins        `json:"defaultsOrigin"`
	// Each scope's own layer, unresolved. The resolved defaults above are what will run; these
	// are what the settings screen shows and writes, one tab per scope.
	WorkspaceDefaults ScopeDefaults `json:"workspaceDefaults"`
	InstallDefaults   ScopeDefaults `json:"installDefaults"`
	// Inherited says, per field, that this conversation never chose it.
	Inherited Inherited `json:"inherited"`
	// Subagent is true when the active conversation was created by another one. Its
	// configuration belongs to that creator, so the UI shows it rather than offering
	// to change it.
	Subagent bool `json:"subagent"`
	// Policy is what this conversation may do with other conversations.
	Policy json.RawMessage `json:"policy,omitempty"`
	// WorkerUp is false when the harness process is gone. Without it a dead backend is
	// indistinguishable from an idle one, because everything here is served from cache.
	WorkerUp    bool   `json:"workerUp"`
	WorkerError string `json:"workerError,omitempty"`
	// Sandbox is where this workspace's commands and file reads actually happen.
	Sandbox   SandboxState            `json:"sandbox"`
	Agents    []protocol.AgentSummary `json:"agents"`
	Skills    []protocol.SkillSummary `json:"skills"`
	Defaults  []protocol.LayerTrace   `json:"defaults"`
	Providers []protocol.ProviderInfo `json:"providers"`
	Seq       int64                   `json:"seq"`
}

// Defaults are one layer's answer to "what runs when nothing more specific does". The
// workspace keeps its own, the install keeps its own, and neither is a copy of the other.
type Defaults struct {
	Model    protocol.ModelBinding `json:"defaultModel,omitzero"`
	Thinking string                `json:"defaultThinking,omitempty"`
	Agent    string                `json:"defaultAgent,omitempty"`
}

// ScopeDefaults is one layer's own defaults, before any resolution. Empty means this layer
// says nothing, which is different from it saying what the layer below says.
type ScopeDefaults struct {
	Model    protocol.ModelBinding `json:"model,omitzero"`
	Thinking string                `json:"thinking,omitempty"`
	Agent    string                `json:"agent,omitempty"`
}

// DefaultOrigins names the layer each resolved default came from: which one is in force,
// not just what it is. A value that came from the install is not a value this workspace
// chose, and the difference is what someone looks at this for.
type DefaultOrigins struct {
	Model    string `json:"model,omitempty"`
	Thinking string `json:"thinking,omitempty"`
	Agent    string `json:"agent,omitempty"`
}

type Control struct {
	opts   Options
	worker *workerpool.Worker

	mu            sync.RWMutex
	describe      protocol.Describe
	conversations []protocol.ConversationInfo
	active        string
	workerUp      bool
	workerError   string
	// sandbox is what the agent's tools can reach, refreshed when the worker starts. It is
	// nil-free on purpose: "no sandbox" is a state the interface has to be able to show.
	sandbox SandboxState
	// One notification per death, drained by the single supervisor loop. A restart loop
	// per death would compound: every failed attempt is another death.
	workerExited chan struct{}
	// lifetime is what the background loops run on. Not the context that happened to start
	// this workspace: that is often one HTTP request, and a supervisor that stops when the
	// first request finishes never supervises anything. Close is what ends it.
	lifetime context.Context
	stop     context.CancelFunc
	// bindings holds only explicit choices, made in a conversation. A conversation
	// with no entry here follows the definition's model or defaultModel.
	bindings map[string]protocol.ModelBinding
	// default* is this workspace's own layer, and is what gets persisted here.
	defaultModel    protocol.ModelBinding
	defaultThinking string
	defaultAgent    string
	/** Whether the conversations that predate naming an agent have been given the general one. */
	generalPinned bool
	// install is the install-wide layer, from <home>/settings.json. Read-only for a
	// workspace: it is changed through the workspace layer, which writes the file once for
	// every workspace to see.
	install Defaults
	// lastResort is what is left when no layer chose a model. It is computed from what the
	// credentials actually offer and is never persisted: a guess written into a workspace
	// would outrank the install default for good, which is the opposite of a fallback.
	lastResort protocol.ModelBinding
	// promptedAt remembers an accepted prompt per conversation, in Unix milliseconds. The
	// worker's run record lags behind the click and outlives dead runs; the stamp covers
	// both directions: just-prompted counts as busy before the record exists, and only a
	// record with recent activity counts after.
	promptedAt map[string]int64
	// settledAt remembers the last settled submission per conversation, in Unix
	// milliseconds. A settlement ends the grace: the run is over because the worker
	// said so, not because ten seconds passed, so the busy sign comes down with the
	// answer instead of lingering after it. A prompt newer than the settlement starts
	// a new grace, which is what a queued follow-up is.
	settledAt map[string]int64
	// announced is the signature of the state attached clients were last told about. The poll
	// compares the state against it, because a change only time can make has no data behind
	// it: nothing refreshes, and only the comparison across ticks can see it.
	announced   string
	resolved    map[string]*protocol.ResolvedAgent
	catalog     protocol.AgentsData
	providers   []protocol.ProviderInfo
	policies    map[string]json.RawMessage
	views       map[string]cachedView
	subscribers map[int]chan protocol.Frame
	// staleSignals wakes one client per state change. It is a channel of its own because a
	// state frame is a signal, not a transcript: on the frame channel a slow write would drop
	// it, or the signal would evict a view frame the client has not read yet, and a client
	// that never hears the state moved keeps the state it read before — busy sign and all.
	staleSignals map[int]chan struct{}
	nextSub      int
	// Which conversation each subscriber watches, and how many watch each. Several
	// clients watching different conversations is what makes browser tabs work.
	subscriberConversation map[int]string
	attachments            map[string]int
}

// cachedView is the last full view per conversation, so switching back is instant
// rather than waiting for the worker's next frame. The annotation is cached with it:
// a view frame is more than its value, and dropping the annotation on the way to a
// newly attached client is invisible until attribution quietly stops working.
type cachedView struct {
	value      []byte
	annotation json.RawMessage
	seq        int64
}

func New(opts Options) *Control {
	return &Control{
		workerExited:           make(chan struct{}, 1),
		opts:                   opts,
		bindings:               map[string]protocol.ModelBinding{},
		resolved:               map[string]*protocol.ResolvedAgent{},
		views:                  map[string]cachedView{},
		subscribers:            map[int]chan protocol.Frame{},
		staleSignals:           map[int]chan struct{}{},
		subscriberConversation: map[int]string{},
		attachments:            map[string]int{},
		policies:               map[string]json.RawMessage{},
		promptedAt:             map[string]int64{},
		settledAt:              map[string]int64{},
	}
}

// Open starts the worker, reads the catalog, and attaches to the active
// conversation, creating the root conversation if the storage is empty.
//
// A harness that cannot start is not a workspace that cannot be used: the control still
// answers, saying the harness is down and why, and the supervisor keeps trying so that fixing
// the file is enough. Refusing to open hides the reason behind a process that never serves —
// which is what a guard with a typo in it used to do to the whole gateway.
func (c *Control) Open(ctx context.Context) {
	// Values are kept, cancellation is not: the caller may be a request that is about to end.
	c.lifetime, c.stop = context.WithCancel(context.WithoutCancel(ctx))
	if err := c.attachToWorker(ctx); err != nil {
		c.mu.Lock()
		c.workerUp = false
		c.workerError = err.Error()
		c.mu.Unlock()
		workerpool.Log("workspace %s: %v", c.opts.Workspace.Name, err)
		go c.supervise(c.lifetime)
		// Something for the supervisor to react to: it retries on a death, and this is the
		// first one.
		select {
		case c.workerExited <- struct{}{}:
		default:
		}
		c.publish(protocol.Frame{Type: "state"})
		return
	}
	go c.watchConversations(c.lifetime)
	go c.supervise(c.lifetime)
}

// attachToWorker is everything that needs a live harness: start it, ask what it can do, read
// the agent catalog, and attach to a conversation.
func (c *Control) attachToWorker(ctx context.Context) error {
	var describe protocol.Describe
	if err := c.startWorker(ctx); err != nil {
		return err
	}
	if err := c.worker.CallInto(ctx, protocol.Command{Type: "describe"}, &describe); err != nil {
		return fmt.Errorf("describe worker: %w", err)
	}
	c.applyDescribe(describe)

	if _, err := c.Agents(ctx); err != nil {
		return fmt.Errorf("read agent catalog: %w", err)
	}
	persistedActive, err := c.restoreState()
	if err != nil {
		return err
	}
	return c.adoptConversation(ctx, persistedActive)
}

// restoreState is everything that has to be true before a conversation can run: our own
// settings, which hold the defaults and the conversation that was open, and a last-resort
// model so a conversation that never chose one still has something to run.
//
// Shared with recovery on purpose. Recovery used to skip it, which was invisible after a
// crash — the values were already in memory — and meant that a workspace whose *first* start
// failed came back with no model and answered nothing.
func (c *Control) restoreState() (string, error) {
	// Our own state first: it holds the default model this install already uses.
	persistedActive := c.loadSettings()
	if err := c.ensureLastResort(); err != nil && !errors.Is(err, ErrNoProvider) {
		return persistedActive, fmt.Errorf("resolve default model: %w", err)
	}
	return persistedActive, nil
}

// adoptConversation attaches this control to a conversation, creating the root one only when
// the storage is empty.
//
// Listing comes first, and that order is the point: the harness creates its own root
// conversation the first time it is used, so deciding to create one without looking makes a
// second, leaves the root empty, and lands on the copy.
func (c *Control) adoptConversation(ctx context.Context, persistedActive string) error {
	conversations, err := c.listConversations(ctx)
	if err != nil {
		return fmt.Errorf("list conversations: %w", err)
	}
	if len(conversations) == 0 {
		if err := c.Create(ctx); err != nil {
			return fmt.Errorf("create first conversation: %w", err)
		}
		return nil
	}

	active := persistedActive
	if !hasConversation(conversations, active) {
		active = defaultConversation(conversations)
	}
	if err := c.Select(ctx, active); err != nil {
		return err
	}
	// No conversation has an agent yet and no provider is connected is a normal
	// first run, not a failure.
	if err := c.ensureConversation(ctx, active); err != nil && !errors.Is(err, ErrNoProvider) {
		return err
	}
	return nil
}

// startWorker launches the harness process and arranges for its death to be noticed.
//
// It refuses to start a second one. A death is announced twice — the process's own exit, and
// the failure of whatever request found it — and without this the second announcement put a
// second harness over the same storage, which is not a restart, it is two writers.
func (c *Control) startWorker(ctx context.Context) error {
	if c.WorkerUp() {
		return errors.New("a worker is already running")
	}
	base := c.opts.WorkerCommand
	if len(base) == 0 {
		base = []string{"bun", "run", "src/main.ts"}
	}
	args := append([]string(nil), base[1:]...)
	args = append(args,
		"--workspace", c.opts.Workspace.Path,
		"--storage", c.opts.StoragePath,
		"--credentials", c.opts.Credentials,
		"--home", c.opts.Home,
	)
	// The sandbox is made first, because the worker is told to use it and refuses to run
	// anything without it. A failure is a state, not a stop: the workspace opens, the tools
	// say what is missing, and the rest of the product works.
	sandboxState := c.provisionSandbox(ctx)
	if sandboxState.Tools {
		args = append(args, "--sandbox", sandbox.Name(c.opts.Workspace.Path))
		if driver := c.opts.Sandbox.Driver(); driver != nil {
			// The worker attaches with this engine's SDK: naming it here is how the two sides
			// of one install cannot disagree about which engine is in use.
			args = append(args, "--sandbox-engine", driver.Name())
		}
	}
	if err := ctx.Err(); err != nil {
		return err
	}
	worker := workerpool.New(workerpool.Config{
		Command: base[0],
		Args:    args,
		Dir:     c.opts.WorkerDir,
		// The worker attaches to the sandbox with the engine's SDK, so it needs the engine's
		// own environment to find it. One engine per install, so this is the same for every
		// workspace.
		Env: sandboxEnv(c.opts.Sandbox),
	})
	worker.OnFrame(c.onFrame)
	if err := worker.Start(ctx); err != nil {
		return fmt.Errorf("start worker: %w", err)
	}
	// Start does not take a context (a worker's lifetime belongs to its owner, not to the
	// request that started it), so closing the window here is what keeps a control that was
	// closed mid-start from leaving a process behind.
	if err := ctx.Err(); err != nil {
		worker.Close()
		return err
	}
	c.mu.Lock()
	c.worker = worker
	c.workerUp = true
	c.workerError = ""
	c.sandbox = sandboxState
	c.mu.Unlock()
	// The identity of the dying worker is part of the notification: a worker that has already
	// been replaced must not be able to mark this control down.
	worker.OnExit(func(err error) { c.workerFailed(worker, err) })
	return nil
}

// supervise owns the worker's lifecycle so restarts cannot multiply. It is the only
// reader of workerExited, so there is exactly one backoff loop however often the
// process dies.
func (c *Control) supervise(ctx context.Context) {
	failures := 0
	for {
		select {
		case <-ctx.Done():
			return
		case <-c.workerExited:
		}
		// Nothing to restart: the announcement was a duplicate, not a death.
		if c.WorkerUp() {
			continue
		}
		failures += 1
		if failures > 5 {
			// Give up rather than burn the machine on a crash loop. The state still says
			// the harness is down, so the interface is honest about it.
			c.mu.Lock()
			c.workerError = "the harness process could not be restarted"
			c.mu.Unlock()
			c.publish(protocol.Frame{Type: "state"})
			select {
			case <-ctx.Done():
				return
			case <-time.After(60 * time.Second):
				failures = 0
				continue
			}
		}
		select {
		case <-ctx.Done():
			return
		case <-time.After(time.Duration(failures) * time.Second):
		}
		if err := c.startWorker(ctx); err != nil {
			workerpool.Log("worker restart %d failed: %v", failures, err)
			// The failed process never started, so nothing will announce it.
			select {
			case c.workerExited <- struct{}{}:
			default:
			}
			continue
		}
		if err := c.recoverWithWorker(ctx); err != nil {
			workerpool.Log("worker restart %d could not be resumed: %v", failures, err)
			continue
		}
		workerpool.Log("worker restarted and resumed")
		failures = 0
	}
}

// workerDied is the difference between a quiet conversation and a dead backend. Without
// it the gateway keeps serving a cached view and everything looks idle and healthy.
func (c *Control) workerFailed(worker *workerpool.Worker, err error) {
	c.mu.Lock()
	// A notification from a worker that has already been replaced is not this control's
	// problem: the process it describes is gone, and the one running now is fine. Acting on it
	// marked a live workspace down, and the signal woke the supervisor to start a second
	// harness over the same storage — two writers, from a late message about a dead process.
	if c.worker != worker {
		c.mu.Unlock()
		workerpool.Log("worker died: %v (already replaced)", err)
		return
	}
	reason := "the harness process ended"
	if err != nil {
		reason = fmt.Sprintf("the harness process ended: %v", err)
	}
	// What that harness itself said, when it said anything: "exit status 1" is not a reason
	// anyone can act on, and the line that is one is in its output. Read from the worker that
	// died, not from whatever is current by the time this runs.
	if words := worker.LastWords(); words != "" {
		reason = fmt.Sprintf("%s — %s", reason, words)
	}
	c.workerUp = false
	c.workerError = reason
	c.mu.Unlock()
	workerpool.Log("worker died: %s", reason)
	c.publish(protocol.Frame{Type: "state"})
	// The supervisor restarts: work is committed before it is shown, so a fresh process
	// resumes every run from its last commit.
	select {
	case c.workerExited <- struct{}{}:
	default:
	}
}

// recoverWithWorker re-reads what the new process knows and re-attaches the conversation
// a client is looking at, so a restart is invisible apart from the pause.
func (c *Control) recoverWithWorker(ctx context.Context) error {
	var describe protocol.Describe
	if err := c.worker.CallInto(ctx, protocol.Command{Type: "describe"}, &describe); err != nil {
		return err
	}
	c.applyDescribe(describe)
	if _, err := c.Agents(ctx); err != nil {
		return err
	}
	persistedActive, err := c.restoreState()
	if err != nil {
		return err
	}
	// The same adoption as a first start, so a workspace that comes back lands where it was
	// rather than on a conversation it just made.
	active := c.activeConversation()
	if active == "" {
		active = persistedActive
	}
	if err := c.adoptConversation(ctx, active); err != nil {
		return err
	}
	c.publish(protocol.Frame{Type: "state"})
	return nil
}

// watchConversations keeps the rail honest about runs happening elsewhere. A run
// belongs to the harness, not to an attachment, so a conversation you are not
// looking at can be working. Nothing pushes that news, so it is polled -- and
// published only when a signature changes, so a quiet workspace stays quiet.
func (c *Control) watchConversations(ctx context.Context) {
	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if !c.Watching() {
				continue
			}
			if _, err := c.listConversations(ctx); err != nil {
				continue
			}
			if c.stateStale() {
				c.publish(protocol.Frame{Type: "state"})
			}
		}
	}
}

// watchedConversations lists the distinct conversations clients are attached to.
func (c *Control) watchedConversations() []string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	seen := map[string]bool{}
	list := make([]string, 0, len(c.attachments))
	for id, count := range c.attachments {
		if count > 0 && !seen[id] {
			seen[id] = true
			list = append(list, id)
		}
	}
	if c.active != "" && !seen[c.active] {
		list = append(list, c.active)
	}
	return list
}

// stateStale reports whether the state has moved since attached clients were last told.
// Against the announcement, not against the previous tick's data: a change only time can
// make — the prompt grace expiring — happens between ticks, and two signatures taken
// milliseconds apart would never see it. The signature is read first and the announcement
// after, so a signal raised in between can only cause an announcement that says the same
// thing twice, never a missed one.
func (c *Control) stateStale() bool {
	signature := c.conversationSignature()
	c.mu.RLock()
	defer c.mu.RUnlock()
	return signature != c.announced
}

// conversationSignature is what the interface sees, not the worker's raw record: the busy
// rule gates a record with a prompt stamp and a freshness window, so a flag that moved only
// because time passed is still a change the rail has to hear about — otherwise a client that
// read the state inside the grace keeps a busy sign nothing will ever take down.
func (c *Control) conversationSignature() string {
	c.mu.RLock()
	infos := append([]protocol.ConversationInfo(nil), c.conversations...)
	c.mu.RUnlock()
	now := time.Now().UnixMilli()
	var builder strings.Builder
	for _, info := range infos {
		fmt.Fprintf(&builder, "%s:%t:%s:%.0f|", info.ID, c.runActive(info, now), info.LastEntryID, info.Tokens)
	}
	return builder.String()
}

// WorkerCall is an escape hatch for small read-only commands, so a diagnostic does
// not need a method and an endpoint of its own.
func (c *Control) WorkerCall(ctx context.Context, kind, conversationID string) (json.RawMessage, error) {
	return c.worker.Call(ctx, protocol.Command{Type: kind, ConversationID: conversationID})
}

func (c *Control) workspaceList() []WorkspaceState {
	if c.opts.Registry == nil {
		return nil
	}
	return Views(c.opts.Registry())
}

// WorkerUp reports whether this workspace's harness process is running.
func (c *Control) WorkerUp() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.workerUp
}

// Watching reports whether a client is attached to any of this workspace's conversations.
func (c *Control) Watching() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return len(c.subscribers) > 0
}

// Busy reports whether any conversation here is running. An eviction must not stop a
// worker mid-run, even when nobody is watching it.
func (c *Control) Busy() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	for _, info := range c.conversations {
		if info.Running {
			return true
		}
	}
	return false
}

// SetWorkspace applies a changed record: a folder that moved, or trust being granted.
func (c *Control) SetWorkspace(workspace Workspace) {
	c.mu.Lock()
	c.opts.Workspace = workspace
	c.mu.Unlock()
}

// Commands lists this workspace's slash commands, global first and workspace shadowing.
func (c *Control) Commands(ctx context.Context) (json.RawMessage, error) {
	return c.worker.Call(ctx, protocol.Command{Type: "commands"})
}

// Policy reports what a conversation may do with other conversations, resolved
// the same way its agent is.
func (c *Control) Policy(ctx context.Context, conversationID string) (json.RawMessage, error) {
	return c.worker.Call(ctx, protocol.Command{Type: "policy", ConversationID: conversationID})
}

func (c *Control) Close() {
	// The loops stop first. A supervisor that sees its worker close takes that for a crash and
	// restarts it from the settings this control was built from, so closing in the other order
	// left a second worker running with the record that had just been replaced — over the same
	// storage as its replacement.
	if c.stop != nil {
		c.stop()
	}
	if c.worker != nil {
		c.worker.Close()
	}
	// The worker is gone, so nothing can use the sandbox: stopping it frees the memory and
	// the engine's own idle timeout would do it anyway. Its disk stays, so a workspace that
	// installed dependencies yesterday still has them.
	if manager := c.opts.Sandbox; manager != nil {
		ctx, cancel := context.WithTimeout(context.Background(), sandbox.Timeout)
		defer cancel()
		if err := manager.Stop(ctx, c.opts.Workspace.Path); err != nil && !errors.Is(err, sandbox.ErrUnavailable) {
			workerpool.Log("stopping the sandbox for %s: %v", c.opts.Workspace.Name, err)
		}
	}
}

// sandboxEnv is what the worker needs to reach the engine's sandboxes, or nothing when there
// is no sandbox tier at all.
func sandboxEnv(manager *sandbox.Manager) []string {
	if manager == nil || manager.Driver() == nil {
		return nil
	}
	return manager.Driver().Env()
}

// provisionSandbox makes sure this workspace has a sandbox and reports what the tools may
// reach. It never fails the worker: a machine without a hypervisor is a supported state, and
// the tools refuse rather than running unconfined.
func (c *Control) provisionSandbox(ctx context.Context) SandboxState {
	manager := c.opts.Sandbox
	if manager == nil {
		return SandboxState{Problem: "no sandbox is configured: tool execution is disabled"}
	}
	report := manager.Report()
	state := SandboxState{Engine: report.Engine, Version: report.Version, Isolated: report.Isolated}
	if problem := manager.Problem(); problem != nil {
		state.Problem = problem.Error()
		return state
	}
	policy := c.opts.Workspace.SandboxPolicy(c.opts.Home, c.opts.UserHome, c.opts.DisableVMNesting)
	if _, err := manager.Produce(ctx, policy, filepath.Dir(c.opts.StoragePath)); err != nil {
		state.Problem = err.Error()
		workerpool.Log("sandbox for %s: %v", c.opts.Workspace.Name, err)
		return state
	}
	// Whether the sandbox that is running nests is what it was created with; this says what
	// the next one gets, and why it cannot when it cannot. A workspace that disables
	// nesting carries neither: its own setting, visible beside this state, is the reason.
	if !policy.DisableVMNesting {
		if support := manager.Nesting(ctx); support.Available {
			state.Nested = true
		} else {
			state.NestedReason = support.Reason
		}
	}
	if status, err := manager.Status(ctx, c.opts.Workspace.Path); err == nil {
		state.Status = status
	}
	state.Tools = true
	return state
}

// Describe returns the cached worker self-report.
func (c *Control) Describe() protocol.Describe {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.describe
}

func (c *Control) State() State {
	c.mu.RLock()
	active := c.active
	c.mu.RUnlock()
	return c.StateFor(active)
}

// StateFor is everything a client needs for one conversation. Each tab asks for its own,
// so two tabs can show two conversations without agreeing on an "active" one.
func (c *Control) StateFor(conversationID string) State {
	// The effective binding is computed before the snapshot lock, because
	// inputsFor takes its own and nested read locks are not re-entrant here.
	active := conversationID
	if active == "" {
		c.mu.RLock()
		active = c.active
		c.mu.RUnlock()
	}
	inputs := c.inputsFor(active)
	isChild := c.isSubagent(active)
	if isChild {
		// The stored configuration wins for a conversation control does not own.
		if info, found := c.conversationInfo(active); found {
			if binding, ok := parseModelBinding(info.Model); ok {
				inputs.explicit.Provider, inputs.explicit.ModelID = binding.Provider, binding.ModelID
			}
			if info.Thinking != "" {
				inputs.explicit.ThinkingLevel = info.Thinking
			}
		}
	}

	// The registry lock is taken before this snapshot's, never inside it. The eviction sweep
	// takes the registry lock and then reads a control, so a state build that read the
	// registry from inside this lock would close the cycle and hang every request behind
	// it. Read it first, and the two orders agree. The defaults are resolved here for the
	// same reason: they take the lock themselves.
	workspaces := c.workspaceList()
	fallback, origins := c.effectiveDefaults()

	c.mu.RLock()
	defer c.mu.RUnlock()
	state := State{
		Workspace: WorkspaceState{
			Name:    c.opts.Workspace.Name,
			Path:    c.opts.Workspace.Path,
			Title:   c.opts.Workspace.Title,
			General: c.opts.Workspace.General,
			Running: c.workerUp,
		},
		Workspaces:    workspaces,
		WorkspacesDir: c.opts.WorkspacesDir,
		Harness:       c.describe.Provider,
		Capabilities:  c.describe.Capabilities,
		Conversations: c.toConversations(c.conversations),
		// Agent is the effective binding, so pickers show what will actually run;
		// Inherited says which parts of it this conversation chose itself.
		Agent:           inputs.effective(),
		Subagent:        isChild,
		Resolved:        c.resolved[active],
		DefaultModel:    fallback.Model,
		DefaultThinking: fallback.Thinking,
		DefaultAgent:    fallback.Agent,
		DefaultsOrigin:  origins,
		WorkspaceDefaults: ScopeDefaults{
			Model:    c.defaultModel,
			Thinking: c.defaultThinking,
			Agent:    c.defaultAgent,
		},
		InstallDefaults: ScopeDefaults{
			Model:    c.install.Model,
			Thinking: c.install.Thinking,
			Agent:    c.install.Agent,
		},
		WorkerUp:    c.workerUp,
		WorkerError: c.workerError,
		Sandbox:     c.sandbox,
		Inherited: Inherited{
			Model:    c.bindings[active].Provider == "",
			Thinking: c.bindings[active].ThinkingLevel == "",
			Agent:    c.bindings[active].Definition == "",
		},
		Agents:    c.catalog.Agents,
		Skills:    c.catalog.Skills,
		Defaults:  c.catalog.Defaults,
		Providers: c.providers,
		Seq:       c.views[active].seq,
		Policy:    c.policies[active],
	}
	// The conversation this call asked for, not the one the worker happens to be attached
	// to. They are the same only once the attach has landed, and a client that asks about a
	// conversation before attaching — which is every switch, and the state fetch that comes
	// with it — was told about a different one. Everything else here already used `active`;
	// this is the field that made the difference visible, because the client follows it.
	for index := range state.Conversations {
		if state.Conversations[index].ID == active {
			conversation := state.Conversations[index]
			state.Conversation = &conversation
			break
		}
	}
	return state
}

// Select attaches to one conversation, detaching the previous one so frames
// describe a single transcript.
func (c *Control) Select(ctx context.Context, conversationID string) error {
	if conversationID == "" {
		return errors.New("conversation id is required")
	}
	c.mu.RLock()
	previous := c.active
	c.mu.RUnlock()
	if previous == conversationID {
		return nil
	}
	if previous != "" {
		if _, err := c.worker.Call(ctx, protocol.Command{Type: "detach", ConversationID: previous}); err != nil {
			workerpool.Log("detach %s: %v", previous, err)
		}
	}
	if _, err := c.worker.Call(ctx, protocol.Command{Type: "attach", ConversationID: conversationID}); err != nil {
		return err
	}
	// The conversation in view is the one whose model, level, and agent someone is about to
	// read off the screen, so the worker is told about it here rather than at the first
	// message. `ensureConversation` is a no-op for one that is already configured.
	if err := c.ensureConversation(ctx, conversationID); err != nil {
		return err
	}
	c.mu.Lock()
	c.active = conversationID
	c.mu.Unlock()
	c.persist()
	// Refresh now rather than waiting for the next tick: the response to this call
	// carries the policy, and a stale policy on a fresh conversation reads as a bug.
	if _, err := c.listConversations(ctx); err != nil {
		workerpool.Log("refresh conversations after select: %v", err)
	}
	// Attaching to a conversation that has no model yet would fail on its next
	// prompt, so selecting one is where it gets configured.
	if err := c.ensureConversation(ctx, conversationID); err != nil && !errors.Is(err, ErrNoProvider) {
		return err
	}
	c.publish(protocol.Frame{Type: "state"})
	return nil
}

// Rename gives a conversation a name. The name is committed into the
// conversation itself, so it is durable and travels with the transcript.
func (c *Control) Rename(ctx context.Context, conversationID, title string) error {
	if strings.TrimSpace(title) == "" {
		return errors.New("title is required")
	}
	if _, err := c.worker.Call(ctx, protocol.Command{
		Type:           "rename",
		ConversationID: conversationID,
		Title:          title,
	}); err != nil {
		return err
	}
	if _, err := c.listConversations(ctx); err != nil {
		return err
	}
	c.publish(protocol.Frame{Type: "state"})
	return nil
}

// Hide tombstones a conversation. Nothing is removed: storage is append-only, so
// a hidden conversation keeps its transcript and can be restored.
func (c *Control) Hide(ctx context.Context, conversationID string, hidden bool) error {
	if _, err := c.worker.Call(ctx, protocol.Command{
		Type:           "hide",
		ConversationID: conversationID,
		Hidden:         hidden,
	}); err != nil {
		return err
	}
	conversations, err := c.listConversations(ctx)
	if err != nil {
		return err
	}
	// Hiding what you are looking at has to move you somewhere.
	if hidden && c.activeConversation() == conversationID {
		if next := firstVisible(conversations); next != "" {
			if err := c.Select(ctx, next); err != nil {
				return err
			}
		} else if err := c.Create(ctx); err != nil {
			return err
		}
	}
	c.publish(protocol.Frame{Type: "state"})
	return nil
}

// Fork branches a conversation at an entry. The fork inherits the transcript up
// to that entry and the agent in effect at that point.
func (c *Control) Fork(ctx context.Context, conversationID, at string) error {
	var response struct {
		ConversationID string `json:"conversationId"`
	}
	if err := c.worker.CallInto(ctx, protocol.Command{
		Type:           "fork",
		ConversationID: conversationID,
		At:             at,
	}, &response); err != nil {
		return err
	}
	if response.ConversationID == "" {
		return errors.New("worker returned no conversation id")
	}

	c.mu.RLock()
	parent := c.bindings[conversationID]
	parentResolved := c.resolved[conversationID]
	c.mu.RUnlock()
	if parent.Provider != "" || parent.Definition != "" {
		c.mu.Lock()
		c.bindings[response.ConversationID] = parent
		c.resolved[response.ConversationID] = parentResolved
		c.mu.Unlock()
	}

	if _, err := c.listConversations(ctx); err != nil {
		return err
	}
	if err := c.Select(ctx, response.ConversationID); err != nil {
		return err
	}
	if parent.Provider == "" {
		if err := c.ensureConversation(ctx, response.ConversationID); err != nil && !errors.Is(err, ErrNoProvider) {
			return err
		}
	}
	c.publish(protocol.Frame{Type: "state"})
	return nil
}

// Create makes a new conversation and selects it.
func (c *Control) Create(ctx context.Context) error {
	var response struct {
		ConversationID string `json:"conversationId"`
	}
	if err := c.worker.CallInto(ctx, protocol.Command{Type: "create"}, &response); err != nil {
		return err
	}
	if response.ConversationID == "" {
		return errors.New("worker returned no conversation id")
	}
	if _, err := c.listConversations(ctx); err != nil {
		return err
	}
	if err := c.Select(ctx, response.ConversationID); err != nil {
		return err
	}
	// A conversation with no model cannot run: configure it now rather than
	// failing on its first prompt. It still counts as "no explicit model".
	if err := c.ensureConversation(ctx, response.ConversationID); err != nil && !errors.Is(err, ErrNoProvider) {
		return err
	}
	// Then it stops inheriting: what resolved when it was created is what it runs, and a
	// default changed tomorrow must not move it (ADR 0017).
	c.pinOne(response.ConversationID)
	return nil
}

// pinBinding is what a conversation would be pinned to: the effective model and the level
// that model can actually express, plus the default agent when one is named and known. It
// reads and decides; nothing here changes anything.
//
// Nothing resolved means nothing to pin: a workspace with no provider keeps inheriting until
// there is something to inherit. A subagent is configured by whatever created it, so pinning
// it here would overwrite that with the defaults.
// GeneralAgent is the agent a conversation runs when nothing named one. The worker ships it as
// a built-in definition, so it can be pinned by name like any other — and an install that
// wants its own general writes `general.md`, which shadows it.
const GeneralAgent = "general"

func (c *Control) pinBinding(conversationID string) (protocol.ModelBinding, bool) {

	if c.isSubagent(conversationID) {
		return protocol.ModelBinding{}, false
	}
	inputs := c.inputsFor(conversationID)
	effective := inputs.effective()
	if effective.Provider == "" || effective.ModelID == "" {
		return protocol.ModelBinding{}, false
	}
	binding := protocol.ModelBinding{
		Provider:      effective.Provider,
		ModelID:       effective.ModelID,
		ThinkingLevel: effective.ThinkingLevel,
	}
	// The agent is pinned by name too: the configured default, or the general one every
	// install has. A definition that does not exist is not pinned — it would fail every open,
	// and the interface has to show a stale default rather than a broken conversation.
	agent := inputs.defaultAgent
	if agent == "" {
		agent = GeneralAgent
	}
	if c.hasAgentDefinition(agent) {
		binding.Definition = agent
	}
	return binding, true
}

// pinOne pins a single conversation, for the one that was just created.
func (c *Control) pinOne(conversationID string) bool {
	binding, ok := c.pinBinding(conversationID)
	if !ok {
		return false
	}
	c.mu.Lock()
	c.bindings[conversationID] = binding
	c.mu.Unlock()
	c.persist()
	return true
}

// pinMissing is the migration for conversations that predate pinning, and it has two parts.
//
// The conversations that never chose are pinned from what resolves at that moment.
// Conversations with a binding are left alone — that is a choice — and so are subagents.
//
// Then, once, the conversations whose binding never named an agent are given the general one.
// Pinning the name is what lets the interface show which agent runs; a conversation that
// clears its definition afterwards is asking to follow the default, and that has to keep
// working, which is why this part happens once rather than on every listing.
func (c *Control) pinMissing(conversations []protocol.ConversationInfo) {
	changed := false

	c.mu.RLock()
	named := c.generalPinned
	c.mu.RUnlock()
	if !named && c.hasAgentDefinition(GeneralAgent) {
		for _, conversation := range conversations {
			if conversation.Parent != "" {
				continue
			}
			c.mu.RLock()
			existing := c.bindings[conversation.ID]
			c.mu.RUnlock()
			chose := existing.Provider != "" || existing.ModelID != "" || existing.Definition != ""
			if !chose || existing.Definition != "" {
				continue
			}
			existing.Definition = GeneralAgent
			c.mu.Lock()
			c.bindings[conversation.ID] = existing
			c.mu.Unlock()
			changed = true
		}
		c.mu.Lock()
		c.generalPinned = true
		c.mu.Unlock()
		changed = true
	}

	for _, conversation := range conversations {
		c.mu.RLock()
		existing := c.bindings[conversation.ID]
		c.mu.RUnlock()
		if existing.Provider != "" || existing.ModelID != "" || existing.Definition != "" {
			continue
		}
		binding, ok := c.pinBinding(conversation.ID)
		if !ok {
			continue
		}
		c.mu.Lock()
		c.bindings[conversation.ID] = binding
		c.mu.Unlock()
		changed = true
	}
	if changed {
		c.persist()
	}
}

func (c *Control) hasAgentDefinition(name string) bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	for _, agent := range c.catalog.Agents {
		if agent.Name == name {
			return true
		}
	}
	return false
}

// AgentChange is a partial update. A nil field means "leave it alone" and an
// empty string means "clear it", which a plain struct could not tell apart.
type AgentChange struct {
	Provider      *string
	ModelID       *string
	ThinkingLevel *string
	Definition    *string
}

// SetAgent applies a change to one conversation. Only fields the caller sets
// become explicit: anything left alone keeps inheriting.
func (c *Control) SetAgent(ctx context.Context, conversationID string, change AgentChange) error {
	c.mu.RLock()
	explicit := c.bindings[conversationID]
	c.mu.RUnlock()

	if change.Provider != nil || change.ModelID != nil {
		provider, modelID := explicit.Provider, explicit.ModelID
		if change.Provider != nil {
			provider = *change.Provider
		}
		if change.ModelID != nil {
			modelID = *change.ModelID
		}
		if (provider == "") != (modelID == "") {
			return errors.New("provider and modelId must be given together")
		}
		// Refused rather than stored: a conversation bound to a model the credentials do not
		// reach cannot run, and the failure would arrive later as a provider error on its next
		// prompt instead of here, where the choice was made. The picker can only offer models
		// of authenticated providers, so this refuses what the interface cannot ask for.
		if provider != "" && !c.isAvailable(c.Describe(), protocol.ModelBinding{Provider: provider, ModelID: modelID}) {
			return unavailableModel(provider, modelID)
		}
		explicit.Provider, explicit.ModelID = provider, modelID
	}
	if change.Definition != nil && *change.Definition != "" {
		// Strictly, unlike resolution: choosing a definition is a request that it exists, and
		// the catalog here is what the worker reported. Resolution stays lenient because it
		// also runs before the worker has described itself.
		c.mu.RLock()
		agents := c.catalog.Agents
		c.mu.RUnlock()
		known := false
		for _, agent := range agents {
			if agent.Name == *change.Definition {
				known = true
				break
			}
		}
		if !known {
			return fmt.Errorf("no agent definition named %q", *change.Definition)
		}
		explicit.Definition = *change.Definition
	} else if change.Definition != nil {
		explicit.Definition = ""
	}
	if change.ThinkingLevel != nil {
		if err := validateThinkingLevel(*change.ThinkingLevel); err != nil {
			return err
		}
		explicit.ThinkingLevel = *change.ThinkingLevel
	}

	effective, err := c.effective(conversationID, explicit)
	if err != nil {
		return err
	}
	var response struct {
		Agent protocol.ResolvedAgent `json:"agent"`
	}
	if err := c.worker.CallInto(ctx, protocol.Command{
		Type:           "open",
		ConversationID: conversationID,
		Agent:          &effective,
	}, &response); err != nil {
		return err
	}

	c.mu.Lock()
	c.bindings[conversationID] = explicit
	resolved := response.Agent
	c.resolved[conversationID] = &resolved
	c.mu.Unlock()
	c.persist()
	return nil
}

// effective resolves what a conversation actually runs: an explicit choice, then
// the definition's model, then the install default. Control decides this rather
// than leaving it to the worker, so "is this model inherited?" has one answer.
// resolveInputs is everything the resolution needs, read under one lock so the
// resolver itself never takes one. Nested read locks are not re-entrant here.
type resolveInputs struct {
	explicit        protocol.ModelBinding
	fallbackModel   protocol.ModelBinding
	defaultThinking string
	defaultAgent    string
	resolved        *protocol.ResolvedAgent
	levels          []string
}

// effectiveModel resolves the model alone: what this conversation chose, then what
// its definition names, then the install default.
func (in resolveInputs) effectiveModel() (string, string) {
	if in.explicit.Provider != "" && in.explicit.ModelID != "" {
		return in.explicit.Provider, in.explicit.ModelID
	}
	if in.resolved != nil {
		if binding, ok := parseModelBinding(in.resolved.Model); ok {
			return binding.Provider, binding.ModelID
		}
	}
	return in.fallbackModel.Provider, in.fallbackModel.ModelID
}

// effective folds the three fields, each with the same order: what this
// conversation chose, then what its definition says, then the install default. A
// definition beating the install default is deliberate — a choice made one layer
// down should not be overridden by a global one.
func (in resolveInputs) effective() protocol.ModelBinding {
	effective := in.explicit
	effective.Provider, effective.ModelID = in.effectiveModel()

	// The whole chain, not a pre-merged value: a level the model cannot express
	// must be able to fall through to the next layer rather than being clamped
	// in place, which is what "fall back to the default" means.
	definitionThinking := ""
	if in.resolved != nil {
		definitionThinking = in.resolved.Thinking
	}
	effective.ThinkingLevel = resolveThinking(
		in.levels,
		effective.ThinkingLevel,
		definitionThinking,
		in.defaultThinking,
	)

	// Record what was asked for when the answer differs, so the UI can say why
	// rather than appearing to have ignored the choice.
	requested := effective.ThinkingRequested
	if requested == "" {
		for _, candidate := range []string{in.explicit.ThinkingLevel, definitionThinking, in.defaultThinking} {
			if candidate != "" {
				requested = candidate
				break
			}
		}
	}
	effective.ThinkingRequested = ""
	if requested != "" && requested != effective.ThinkingLevel {
		effective.ThinkingRequested = requested
	}

	if effective.Definition == "" {
		effective.Definition = in.defaultAgent
	}
	// And the general agent is what runs when nothing named one. Naming it here is what lets
	// the interface show an agent for every conversation, including a subagent's: that one's
	// configuration is copied from its creator and never re-applied, so there is nothing
	// else that would ever fill the name in.
	if effective.Definition == "" {
		effective.Definition = GeneralAgent
	}
	return effective
}

// origins names the layers, in the words the settings sheet uses.
const (
	originWorkspace  = "workspace"
	originInstall    = "install"
	originLastResort = "last-resort"
)

// effectiveDefaults resolves what applies to a conversation that has chosen nothing: this
// workspace's own default, then the install's, then what is left when neither has one.
//
// A layer falls through when its choice is not usable — a model the credentials no longer
// offer, an agent definition that has gone — instead of being overwritten, because a choice
// that is remembered applies again when the provider or the file comes back.
func (c *Control) effectiveDefaults() (Defaults, DefaultOrigins) {
	// Read under one lock, decide outside it: isAvailable and the agent catalog are read
	// from the same snapshot, and nothing here blocks.
	c.mu.RLock()
	describe := c.describe
	workspace := Defaults{Model: c.defaultModel, Thinking: c.defaultThinking, Agent: c.defaultAgent}
	install := c.install
	lastResort := c.lastResort
	agents := append([]protocol.AgentSummary(nil), c.catalog.Agents...)
	c.mu.RUnlock()

	resolved := Defaults{}
	origins := DefaultOrigins{}
	switch {
	case c.modelUsable(describe, workspace.Model):
		resolved.Model, origins.Model = workspace.Model, originWorkspace
	case c.modelUsable(describe, install.Model):
		resolved.Model, origins.Model = install.Model, originInstall
	case lastResort.Provider != "" && lastResort.ModelID != "":
		resolved.Model, origins.Model = lastResort, originLastResort
	}
	resolved.Thinking = firstNonEmpty(workspace.Thinking, install.Thinking)
	if resolved.Thinking == "" {
		origins.Thinking = ""
	} else if workspace.Thinking != "" {
		origins.Thinking = originWorkspace
	} else {
		origins.Thinking = originInstall
	}
	// A definition that is gone is not usable: pointing every inheriting conversation at it
	// would fail them all, where the layer below still works.
	for _, candidate := range []struct {
		name   string
		origin string
	}{{workspace.Agent, originWorkspace}, {install.Agent, originInstall}} {
		if candidate.name == "" {
			continue
		}
		if !definitionExists(agents, candidate.name) {
			continue
		}
		resolved.Agent, origins.Agent = candidate.name, candidate.origin
		break
	}
	return resolved, origins
}

// modelUsable reports whether a layer's model can run here. An empty catalog means the
// worker has not described itself yet, which is not the same as "not available": treating it
// that way would resolve a different model for the moment before the worker answers.
func (c *Control) modelUsable(describe protocol.Describe, binding protocol.ModelBinding) bool {
	if binding.Provider == "" || binding.ModelID == "" {
		return false
	}
	if len(describe.Providers) == 0 {
		return true
	}
	return c.isAvailable(describe, binding)
}

func definitionExists(agents []protocol.AgentSummary, name string) bool {
	if len(agents) == 0 {
		return true
	}
	for _, agent := range agents {
		if agent.Name == name {
			return true
		}
	}
	return false
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

func (c *Control) inputsFor(conversationID string) resolveInputs {
	// Resolved first, because it takes its own lock and nested read locks are not
	// re-entrant here.
	fallback, _ := c.effectiveDefaults()
	c.mu.RLock()
	inputs := resolveInputs{
		explicit:        c.bindings[conversationID],
		fallbackModel:   fallback.Model,
		defaultThinking: fallback.Thinking,
		defaultAgent:    fallback.Agent,
		resolved:        c.resolved[conversationID],
	}
	c.mu.RUnlock()
	// Clamp against the model that will actually run: an inheriting conversation
	// has no explicit model, which is exactly when clamping matters most.
	provider, modelID := inputs.effectiveModel()
	inputs.levels = c.supportedThinking(provider, modelID)
	return inputs
}

func (c *Control) effective(conversationID string, explicit protocol.ModelBinding) (protocol.ModelBinding, error) {
	inputs := c.inputsFor(conversationID)
	inputs.explicit = explicit
	effective := inputs.effective()
	if effective.Provider == "" || effective.ModelID == "" {
		return effective, fmt.Errorf("%w: connect a provider or set a default model", ErrNoProvider)
	}
	return effective, nil
}

// thinkingLevels is the ordered scale, weakest first.
var thinkingLevels = []string{"off", "minimal", "low", "medium", "high", "xhigh", "max"}

// resolveThinking picks the level to run, given an ordered list of preferences:
// what this conversation chose, then what its definition says, then the install
// default.
//
//  1. the first preference the model supports;
//  2. otherwise the closest supported level below the most specific preference;
//  3. otherwise the lowest level the model offers.
//
// Step 3 exists because "below" can be empty: a model whose only level is `high`
// cannot honour a request for `off`, and the honest answer is the level it has,
// not a setting that silently does nothing. An empty result means no preference
// was expressed, and the model's own default stands.
func resolveThinking(levels []string, preferred ...string) string {
	reference := ""
	for _, candidate := range preferred {
		if candidate != "" {
			reference = candidate
			break
		}
	}
	if reference == "" {
		return ""
	}
	if len(levels) == 0 {
		// An unknown model has no declared levels, so nothing to resolve against.
		return reference
	}
	supported := make(map[string]bool, len(levels))
	for _, level := range levels {
		supported[level] = true
	}
	for _, candidate := range preferred {
		if candidate != "" && supported[candidate] {
			return candidate
		}
	}
	// Nothing preferred is available: the closest level below the most specific
	// preference, then the lowest the model has.
	best := ""
	for _, level := range thinkingLevels {
		if level == reference {
			break
		}
		if supported[level] {
			best = level
		}
	}
	if best != "" {
		return best
	}
	return lowestThinking(levels)
}

// lowestThinking returns the weakest level in a set, ordered by the scale rather
// than by the order the provider happened to list.
func lowestThinking(levels []string) string {
	lowest := ""
	lowestRank := len(thinkingLevels) + 1
	for _, level := range levels {
		rank := len(thinkingLevels)
		for index, known := range thinkingLevels {
			if known == level {
				rank = index
				break
			}
		}
		if rank < lowestRank {
			lowest, lowestRank = level, rank
		}
	}
	return lowest
}

// supportedThinking reads the levels a model declares, from the worker's catalog.
func (c *Control) supportedThinking(provider, modelID string) []string {
	if provider == "" || modelID == "" {
		return nil
	}
	c.mu.RLock()
	defer c.mu.RUnlock()
	for _, info := range c.providers {
		if info.ID != provider {
			continue
		}
		for _, model := range info.Models {
			if model.ID == modelID {
				return model.ThinkingLevels
			}
		}
	}
	return nil
}

// SetDefaultThinking changes the level used when neither the conversation nor its
// definition names one. It is validated against the scale, not against one model:
// control clamps per model when it applies.
func (c *Control) SetDefaultThinking(ctx context.Context, level string) error {
	if err := validateThinkingLevel(level); err != nil {
		return err
	}
	c.mu.Lock()
	c.defaultThinking = level
	c.mu.Unlock()
	return c.reapplyInheriting(ctx)
}

// SetDefaultAgent changes which definition conversations run when they have none
// of their own. An empty name means the layered defaults only.
func (c *Control) SetDefaultAgent(ctx context.Context, name string) error {
	if name != "" {
		c.mu.RLock()
		found := false
		for _, agent := range c.catalog.Agents {
			if agent.Name == name {
				found = true
				break
			}
		}
		c.mu.RUnlock()
		if !found {
			return fmt.Errorf("no agent definition named %q", name)
		}
	}
	c.mu.Lock()
	c.defaultAgent = name
	c.mu.Unlock()
	return c.reapplyInheriting(ctx)
}

// reapplyInheriting re-applies every conversation that still follows the defaults,
// so a change to them is visible without a restart. Conversations that chose keep
// their choice.
func (c *Control) reapplyInheriting(ctx context.Context) error {
	c.mu.RLock()
	ids := make([]string, 0, len(c.conversations))
	for _, conversation := range c.conversations {
		ids = append(ids, conversation.ID)
	}
	c.mu.RUnlock()
	var firstErr error
	for _, id := range ids {
		if err := c.reapply(ctx, id); err != nil && firstErr == nil {
			firstErr = err
		}
	}
	c.persist()
	c.publish(protocol.Frame{Type: "state"})
	return firstErr
}

// loadInstallDefaults reads the install-wide layer.
func (c *Control) loadInstallDefaults() {
	install, err := LoadDefaults(filepath.Join(c.opts.Home, "settings.json"))
	if err != nil {
		workerpool.Log("install defaults unreadable, using this workspace's: %v", err)
		return
	}
	c.mu.Lock()
	c.install = install
	c.mu.Unlock()
}

// SetInstallDefaults replaces the install-wide layer, which is what every workspace falls
// back to when it has no default of its own.
func (c *Control) SetInstallDefaults(ctx context.Context, defaults Defaults) error {
	c.mu.Lock()
	c.install = defaults
	c.mu.Unlock()
	return c.reapplyInheriting(ctx)
}

// LoadDefaults reads a defaults file. A missing one is an empty layer, not an error: most
// installs never set one, and the layers below still resolve.
func LoadDefaults(path string) (Defaults, error) {
	var defaults Defaults
	payload, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return defaults, nil
	}
	if err != nil {
		return defaults, err
	}
	if err := json.Unmarshal(payload, &defaults); err != nil {
		return Defaults{}, fmt.Errorf("%s: %w", path, err)
	}
	return defaults, nil
}

// SaveDefaults writes a defaults file, atomically and privately.
func SaveDefaults(path string, defaults Defaults) error {
	payload, err := json.MarshalIndent(defaults, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	temp := path + ".tmp"
	if err := os.WriteFile(temp, append(payload, '\n'), 0o600); err != nil {
		return err
	}
	return os.Rename(temp, path)
}

// SetDefaultModel changes what conversations without an explicit model run.
func (c *Control) SetDefaultModel(ctx context.Context, provider, modelID string) error {
	if (provider == "") != (modelID == "") {
		return errors.New("a model default needs both a provider and a model id")
	}
	if provider == "" {
		// Clearing this workspace's choice is not the same as having none: it falls back to
		// the install's default or the last resort instead of being left unusable.
		c.mu.Lock()
		c.defaultModel = protocol.ModelBinding{}
		c.mu.Unlock()
		return c.reapplyInheriting(ctx)
	}
	if !c.isAvailable(c.Describe(), protocol.ModelBinding{Provider: provider, ModelID: modelID}) {
		return unavailableModel(provider, modelID)
	}
	c.mu.Lock()
	c.defaultModel = protocol.ModelBinding{Provider: provider, ModelID: modelID}
	c.mu.Unlock()
	return c.reapplyInheriting(ctx)
}

// ensureLastResort works out what runs when no layer chose a model, so the first prompt
// always has something. It writes nothing: see the field it fills.
func (c *Control) ensureLastResort() error {
	binding, err := c.deriveLastResort(c.Describe())
	if err != nil {
		return err
	}
	c.mu.Lock()
	c.lastResort = binding
	c.mu.Unlock()
	return nil
}

// ensureConversation configures a conversation that has no explicit model, so it
// can run, without making the default an explicit choice it never made.
func (c *Control) ensureConversation(ctx context.Context, conversationID string) error {
	c.mu.RLock()
	explicit := c.bindings[conversationID]
	// A binding is not the same as an applied binding: pinning writes one without talking to
	// the worker, and a conversation whose binding was never opened has no model to run with.
	applied := c.resolved[conversationID] != nil
	for _, info := range c.conversations {
		if info.ID == conversationID && info.Parent != "" {
			// A subagent is configured by whatever created it. Re-applying a binding
			// here would overwrite that with the install default.
			c.mu.RUnlock()
			return nil
		}
	}
	c.mu.RUnlock()
	if applied && explicit.Provider != "" && c.isAvailable(c.Describe(), explicit) {
		return nil
	}
	return c.reapply(ctx, conversationID)
}

// isSubagent reports whether a conversation was created by another one.
func (c *Control) isSubagent(conversationID string) bool {
	info, found := c.conversationInfo(conversationID)
	return found && info.Parent != ""
}

// conversationInfo is one conversation from the cached list, read under one lock. Callers that
// need it twice, or need two fields of it, take it once.
func (c *Control) conversationInfo(conversationID string) (protocol.ConversationInfo, bool) {
	c.mu.RLock()
	defer c.mu.RUnlock()
	for _, info := range c.conversations {
		if info.ID == conversationID {
			return info, true
		}
	}
	return protocol.ConversationInfo{}, false
}

// parseModelBinding reads the "provider/modelId" form the overlay, the stored configuration,
// and the --model flag all share.
func parseModelBinding(value string) (protocol.ModelBinding, bool) {
	parts := strings.SplitN(value, "/", 2)
	if len(parts) != 2 || parts[0] == "" || parts[1] == "" {
		return protocol.ModelBinding{}, false
	}
	return protocol.ModelBinding{Provider: parts[0], ModelID: parts[1]}, true
}

// validateThinkingLevel refuses a name outside the scale. Control clamps to what a model
// supports when it applies, so this is only about a level that could never mean anything.
func validateThinkingLevel(level string) error {
	if level == "" || contains(thinkingLevels, level) {
		return nil
	}
	return fmt.Errorf("unknown thinking level %q; expected one of %s", level, strings.Join(thinkingLevels, ", "))
}

// unavailableModel is the one refusal for a model the credentials do not reach, so the three
// places that refuse one say the same thing.
func unavailableModel(provider, modelID string) error {
	return fmt.Errorf("%s/%s is not available with the current credentials", provider, modelID)
}

func (c *Control) reapply(ctx context.Context, conversationID string) error {
	c.mu.RLock()
	explicit := c.bindings[conversationID]
	c.mu.RUnlock()
	effective, err := c.effective(conversationID, explicit)
	if err != nil {
		return err
	}
	var response struct {
		Agent protocol.ResolvedAgent `json:"agent"`
	}
	if err := c.worker.CallInto(ctx, protocol.Command{
		Type:           "open",
		ConversationID: conversationID,
		Agent:          &effective,
	}, &response); err != nil {
		return err
	}
	c.mu.Lock()
	resolved := response.Agent
	c.resolved[conversationID] = &resolved
	c.mu.Unlock()
	return nil
}

func contains(values []string, wanted string) bool {
	return slices.Contains(values, wanted)
}

// Agents returns the overlay catalog: every definition and what it resolves to.
func (c *Control) Agents(ctx context.Context) (protocol.AgentsData, error) {
	var data protocol.AgentsData
	if err := c.worker.CallInto(ctx, protocol.Command{Type: "agents"}, &data); err != nil {
		return protocol.AgentsData{}, err
	}
	c.mu.Lock()
	c.catalog = data
	c.mu.Unlock()
	return data, nil
}

// Reload re-reads definitions and config from disk, then re-applies every
// conversation's binding so an edited file takes effect without a restart.
func (c *Control) Reload(ctx context.Context) error {
	if _, err := c.worker.Call(ctx, protocol.Command{Type: "reload"}); err != nil {
		return err
	}
	if _, err := c.Agents(ctx); err != nil {
		return err
	}
	// A definition may have been renamed or removed. Resolution skips one that is gone and
	// falls through to the layer below, so nothing is erased here: the choice survives and
	// applies again if the file comes back.
	c.mu.RLock()
	gone := c.defaultAgent != "" && !definitionExists(c.catalog.Agents, c.defaultAgent)
	c.mu.RUnlock()
	if gone {
		workerpool.Log("default agent %q is gone; using the next layer down", c.defaultAgent)
	}
	return c.reapplyInheriting(ctx)
}

// Refresh re-reads the worker's provider catalog and adopt a usable agent
// binding for the active conversation when the current one is unusable.
func (c *Control) Refresh(ctx context.Context) error {
	var describe protocol.Describe
	if err := c.worker.CallInto(ctx, protocol.Command{Type: "describe"}, &describe); err != nil {
		return err
	}
	c.applyDescribe(describe)
	if err := c.ensureLastResort(); err != nil && !errors.Is(err, ErrNoProvider) {
		return err
	}
	if active := c.activeConversation(); active != "" {
		return c.ensureConversation(ctx, active)
	}
	return nil
}

// Login runs a provider login flow in the worker. It returns as soon as the
// flow starts: the interaction arrives as `auth` frames, and a device flow can
// take minutes.
func (c *Control) Login(ctx context.Context, providerID, authType string) error {
	c.mu.Lock()
	c.nextSub++
	authID := fmt.Sprintf("auth-%d", c.nextSub)
	c.mu.Unlock()

	go func() {
		_, err := c.worker.Call(context.WithoutCancel(ctx), protocol.Command{
			Type:       "login",
			AuthID:     authID,
			ProviderID: providerID,
			AuthType:   authType,
		})
		if err != nil {
			workerpool.Log("login %s failed: %v", providerID, err)
		}
		if refreshErr := c.Refresh(context.WithoutCancel(ctx)); refreshErr != nil {
			workerpool.Log("refresh after login: %v", refreshErr)
		}
		c.publish(protocol.Frame{Type: "state"})
	}()
	return nil
}

// Logout forgets one provider's stored credential and re-adopts bindings, so a
// revoked key cannot keep spending and the picker cannot keep offering it.
func (c *Control) Logout(ctx context.Context, providerID string) error {
	if _, err := c.worker.Call(ctx, protocol.Command{Type: "logout", ProviderID: providerID}); err != nil {
		return err
	}
	c.mu.Lock()
	for id, binding := range c.bindings {
		if binding.Provider == providerID {
			c.bindings[id] = protocol.ModelBinding{}
			delete(c.resolved, id)
		}
	}
	c.mu.Unlock()
	if err := c.Refresh(ctx); err != nil && !errors.Is(err, ErrNoProvider) {
		return err
	}
	c.persist()
	c.publish(protocol.Frame{Type: "state"})
	return nil
}

// AnswerAuth answers one login prompt. Cancelled rejects it.
func (c *Control) AnswerAuth(ctx context.Context, authID, promptID, value string, cancelled bool) error {
	return c.worker.CallInto(ctx, protocol.Command{
		Type:      "auth_answer",
		AuthID:    authID,
		PromptID:  promptID,
		Value:     value,
		Cancelled: cancelled,
	}, nil)
}

// CancelAuth aborts a running login flow.
func (c *Control) CancelAuth(ctx context.Context, authID string) error {
	return c.worker.CallInto(ctx, protocol.Command{Type: "auth_cancel", AuthID: authID}, nil)
}

func (c *Control) Prompt(ctx context.Context, conversationID, text string, when protocol.WhenBusy) error {
	if strings.TrimSpace(text) == "" {
		return errors.New("empty message")
	}
	// A conversation about to run must be configured first: pinning writes a binding without
	// opening it, and a worker that was never told has no model to run the turn with.
	if err := c.ensureConversation(ctx, conversationID); err != nil {
		return err
	}
	// A message that opens with a slash may be a command. The worker expands it, because
	// that is where the templates live; unknown names come back unchanged, so a message
	// that happens to start with a slash is never rewritten.
	if strings.HasPrefix(strings.TrimSpace(text), "/") {
		var expanded struct {
			Text    string `json:"text"`
			Command string `json:"command"`
		}
		if err := c.worker.CallInto(ctx, protocol.Command{Type: "expand", Text: text}, &expanded); err != nil {
			workerpool.Log("expanding %q: %v", text, err)
		} else if expanded.Command != "" {
			text = expanded.Text
		}
	}
	if err := c.worker.CallInto(ctx, protocol.Command{
		Type:           "prompt",
		ConversationID: conversationID,
		Text:           text,
		WhenBusy:       when,
	}, nil); err != nil {
		return err
	}
	c.mu.Lock()
	c.promptedAt[conversationID] = time.Now().UnixMilli()
	c.mu.Unlock()
	return nil
}

func (c *Control) Abort(ctx context.Context, conversationID string) error {
	return c.worker.CallInto(ctx, protocol.Command{Type: "abort", ConversationID: conversationID}, nil)
}

func (c *Control) Usage(ctx context.Context) (json.RawMessage, error) {
	return c.worker.Call(ctx, protocol.Command{Type: "usage"})
}

// Subscribe attaches one client to one conversation. The view it returns is that
// conversation's, if any, so a late joiner starts from committed state. An empty id means the
// conversation this install last used, which is what a fresh tab lands on. The second channel
// is the state signal: a value on it means the state the client holds is stale.
func (c *Control) Subscribe(ctx context.Context, conversationID string) (int, <-chan protocol.Frame, <-chan struct{}, *protocol.Frame, error) {
	c.mu.Lock()
	if conversationID == "" {
		conversationID = c.active
	}
	first := c.attachments[conversationID] == 0
	c.attachments[conversationID] += 1
	id := c.nextSub
	c.nextSub++
	channel := make(chan protocol.Frame, 1)
	stale := make(chan struct{}, 1)
	c.subscribers[id] = channel
	c.staleSignals[id] = stale
	c.subscriberConversation[id] = conversationID
	cached, hasCache := c.views[conversationID]
	c.mu.Unlock()

	// The worker subscribes per conversation, so the first watcher is what asks for it.
	if first && conversationID != "" {
		if _, err := c.worker.Call(ctx, protocol.Command{Type: "attach", ConversationID: conversationID}); err != nil {
			c.Unsubscribe(id)
			return 0, nil, nil, nil, err
		}
		// Fetch its policy now rather than leaving a client to see state without one until
		// the next refresh tick, which reads as a broken inspector for a few seconds.
		if policy, err := c.worker.Call(ctx, protocol.Command{Type: "policy", ConversationID: conversationID}); err == nil {
			c.mu.Lock()
			c.policies[conversationID] = policy
			c.mu.Unlock()
		}
	}

	// The newest watcher decides what a new tab opens on — but only a conversation the
	// worker could attach to. A failed attach must not poison the active conversation for
	// every tab behind it.
	if conversationID != "" {
		c.mu.Lock()
		c.active = conversationID
		c.mu.Unlock()
	}

	var initial *protocol.Frame
	if hasCache && cached.value != nil {
		frame := protocol.Frame{
			Type:           "view",
			ConversationID: conversationID,
			Seq:            cached.seq,
			Value:          append([]byte(nil), cached.value...),
			Acornfall:      append(json.RawMessage(nil), cached.annotation...),
		}
		initial = &frame
	}
	return id, channel, stale, initial, nil
}

// Unsubscribe releases one client. The worker is told to stop watching only when the last
// watcher of that conversation leaves, and never for the one this install remembers.
func (c *Control) Unsubscribe(id int) {
	c.mu.Lock()
	conversationID := c.subscriberConversation[id]
	delete(c.subscribers, id)
	delete(c.staleSignals, id)
	delete(c.subscriberConversation, id)
	if conversationID != "" {
		c.attachments[conversationID] -= 1
		if c.attachments[conversationID] < 0 {
			c.attachments[conversationID] = 0
		}
	}
	last := conversationID != "" && c.attachments[conversationID] == 0 && conversationID != c.active
	c.mu.Unlock()

	if last {
		if _, err := c.worker.Call(context.Background(), protocol.Command{
			Type:           "detach",
			ConversationID: conversationID,
		}); err != nil {
			workerpool.Log("detach %s: %v", conversationID, err)
		}
	}
}

func (c *Control) onFrame(frame protocol.Frame) {
	c.publish(frame)
	// Titles are derived from the first user message, so a settled run is the
	// moment a conversation's name can change. The settlement also ends the prompt
	// grace: the run is over because the worker said so, and the busy sign should come
	// down with the answer rather than lingering for the rest of the ten seconds.
	if frame.Type == "submission" {
		c.mu.Lock()
		c.settledAt[frame.ConversationID] = time.Now().UnixMilli()
		c.mu.Unlock()
		go func() {
			ctx := context.Background()
			if _, err := c.listConversations(ctx); err != nil {
				workerpool.Log("refresh conversation list: %v", err)
				return
			}
			c.publish(protocol.Frame{Type: "state"})
		}()
	}
}

// notifyState wakes every attached client: the state it holds is stale, and the HTTP layer
// answers each one with a fresh state for its own conversation. A signal already waiting
// says the same thing, so a second one is not a second wakeup. What was announced is
// remembered here, so the poll can tell a change it has already announced from one only time
// has made.
func (c *Control) notifyState() {
	signature := c.conversationSignature()
	c.mu.Lock()
	c.announced = signature
	signals := make([]chan struct{}, 0, len(c.staleSignals))
	for _, signal := range c.staleSignals {
		signals = append(signals, signal)
	}
	c.mu.Unlock()
	for _, signal := range signals {
		select {
		case signal <- struct{}{}:
		default:
		}
	}
}

// publish fans one frame out to attached clients. A view frame is a complete
// value, so the newest supersedes any undelivered older one; a slow client loses
// frames, never state.
func (c *Control) publish(frame protocol.Frame) {
	// A state frame is a signal and takes the other road: the frame channel would let a slow
	// write drop it, and a client that never hears the state moved keeps the state it read
	// before — the busy sign outliving the run is exactly that.
	if frame.Type == "state" {
		c.notifyState()
		return
	}
	c.mu.Lock()
	if frame.Type == "view" {
		c.views[frame.ConversationID] = cachedView{
			value:      append([]byte(nil), frame.Value...),
			annotation: append(json.RawMessage(nil), frame.Acornfall...),
			seq:        frame.Seq,
		}
	}
	subscribers := make([]chan protocol.Frame, 0, len(c.subscribers))
	for _, channel := range c.subscribers {
		subscribers = append(subscribers, channel)
	}
	coalesce := frame.Type == "view"
	c.mu.Unlock()

	for _, channel := range subscribers {
		if coalesce {
			select {
			case channel <- frame:
			default:
				select {
				case <-channel:
				default:
				}
				select {
				case channel <- frame:
				default:
				}
			}
			continue
		}
		select {
		case channel <- frame:
		default:
		}
	}
}

// RefreshConversations re-reads the list on demand, for callers that are not holding
// an event stream open.
func (c *Control) RefreshConversations(ctx context.Context) error {
	_, err := c.listConversations(ctx)
	return err
}

func (c *Control) listConversations(ctx context.Context) ([]protocol.ConversationInfo, error) {
	var data struct {
		Conversations []protocol.ConversationInfo `json:"conversations"`
	}
	if err := c.worker.CallInto(ctx, protocol.Command{Type: "conversations"}, &data); err != nil {
		return nil, err
	}
	c.mu.Lock()
	c.conversations = data.Conversations
	c.mu.Unlock()

	// Conversations that never chose are pinned to what resolves now. Idempotent, and it runs
	// on every listing because a listing is the only place that sees every conversation.
	c.pinMissing(data.Conversations)

	// Policy for every conversation a client is watching, so an inspector is correct in
	// whichever tab it happens to be open.
	for _, conversationID := range c.watchedConversations() {
		policy, err := c.worker.Call(ctx, protocol.Command{Type: "policy", ConversationID: conversationID})
		if err != nil {
			continue
		}
		c.mu.Lock()
		c.policies[conversationID] = policy
		c.mu.Unlock()
	}
	return data.Conversations, nil
}

func (c *Control) activeConversation() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return c.active
}

func (c *Control) applyDescribe(describe protocol.Describe) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.describe = describe
	c.providers = describe.Providers
}

// lastResortModels are tried in order when no layer has chosen a model, so an install with
// credentials always runs something deliberate rather than whatever is listed first. It is a
// preference, not a rule: a model nobody offers is skipped.
var lastResortModels = []string{"deepseek-v4.1-flash"}

// deriveLastResort picks what runs when no layer chose a model: the --model flag, then the
// preferred models, then the first authenticated provider's first model. Only the flag and
// the preference are decisions; the end of the line is a guess, and it is reported as the
// last resort rather than being stored as though someone had chosen it.
func (c *Control) deriveLastResort(describe protocol.Describe) (protocol.ModelBinding, error) {
	if model := strings.TrimSpace(c.opts.Model); model != "" {
		binding, ok := parseModelBinding(model)
		if !ok {
			return protocol.ModelBinding{}, fmt.Errorf("--model must be provider/modelId, got %q", model)
		}
		return binding, nil
	}
	for _, wanted := range lastResortModels {
		for _, provider := range describe.Providers {
			if !provider.Authenticated {
				continue
			}
			for _, model := range provider.Models {
				if model.ID == wanted {
					return protocol.ModelBinding{Provider: provider.ID, ModelID: wanted}, nil
				}
			}
		}
	}
	for _, provider := range describe.Providers {
		if !provider.Authenticated || len(provider.Models) == 0 {
			continue
		}
		return protocol.ModelBinding{Provider: provider.ID, ModelID: provider.Models[0].ID}, nil
	}
	return protocol.ModelBinding{}, fmt.Errorf(
		"%w: run `acornfall provider add <provider> <api-key>` or connect one in the UI", ErrNoProvider,
	)
}

func (c *Control) isAvailable(describe protocol.Describe, binding protocol.ModelBinding) bool {
	for _, provider := range describe.Providers {
		if provider.ID != binding.Provider || !provider.Authenticated {
			continue
		}
		for _, model := range provider.Models {
			if model.ID == binding.ModelID {
				return true
			}
		}
	}
	return false
}

type persistedSettings struct {
	Active          string                           `json:"active,omitempty"`
	GeneralPinned   bool                             `json:"generalPinned,omitempty"`
	DefaultModel    protocol.ModelBinding            `json:"defaultModel,omitzero"`
	DefaultThinking string                           `json:"defaultThinking,omitempty"`
	DefaultAgent    string                           `json:"defaultAgent,omitempty"`
	Agents          map[string]protocol.ModelBinding `json:"agents,omitempty"`
}

// loadSettings reads our own state: the default model, the active conversation,
// and which conversations chose a model. It must run before ensureDefault, or
// ensureDefault derives a default and overwrites the one on disk.
func (c *Control) loadSettings() string {
	// The install layer first, and whatever this workspace's own file says: a workspace that
	// has never saved settings has no file, and it still follows the install's defaults.
	c.loadInstallDefaults()
	if c.opts.SettingsPath == "" {
		return ""
	}
	payload, err := os.ReadFile(c.opts.SettingsPath)
	if err != nil {
		return ""
	}
	var settings persistedSettings
	if err := json.Unmarshal(payload, &settings); err != nil {
		return ""
	}
	if settings.DefaultModel.Provider != "" && settings.DefaultModel.ModelID != "" {
		c.mu.Lock()
		c.defaultModel = protocol.ModelBinding{
			Provider: settings.DefaultModel.Provider,
			ModelID:  settings.DefaultModel.ModelID,
		}
		c.mu.Unlock()
	}
	c.mu.Lock()
	c.defaultThinking = settings.DefaultThinking
	c.defaultAgent = settings.DefaultAgent
	c.generalPinned = settings.GeneralPinned
	c.mu.Unlock()
	if settings.Agents != nil {
		c.mu.Lock()
		for id, binding := range settings.Agents {
			if binding.Provider == "" && binding.ModelID == "" && binding.Definition == "" {
				continue
			}
			c.bindings[id] = binding
		}
		c.mu.Unlock()
	}
	return settings.Active
}

func (c *Control) persist() {
	if c.opts.SettingsPath == "" {
		return
	}
	c.mu.RLock()
	// This workspace's own layer, not the resolved one: writing the resolved value here
	// would turn the install's default, or a guess, into this workspace's choice and it
	// would outrank every layer below for good.
	settings := persistedSettings{
		Active:          c.active,
		GeneralPinned:   c.generalPinned,
		DefaultModel:    c.defaultModel,
		DefaultThinking: c.defaultThinking,
		DefaultAgent:    c.defaultAgent,
		Agents:          map[string]protocol.ModelBinding{},
	}
	for id, binding := range c.bindings {
		if binding.Provider == "" && binding.ModelID == "" && binding.Definition == "" {
			continue
		}
		settings.Agents[id] = binding
	}
	c.mu.RUnlock()

	payload, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return
	}
	temp := c.opts.SettingsPath + ".tmp"
	if err := os.WriteFile(temp, append(payload, '\n'), 0o600); err != nil {
		return
	}
	_ = os.Rename(temp, c.opts.SettingsPath)
}

// runActive is the one busy rule the interface reads. The worker's run record is the
// signal, but it lags behind the click and outlives dead runs, so both directions are
// gated: a prompt accepted in the last ten seconds counts before the record exists, and a
// record only counts while the activity is fresh. The grace ends early when the run does:
// a settled submission is the worker saying it finished, so the sign comes down with the
// answer rather than outliving it by seconds. Thirty minutes of silence with no new
// prompt is a residue, not a run — a legitimately quiet hour-long tool call is the known
// cost, and its tool cards still say it is working.
func (c *Control) runActive(info protocol.ConversationInfo, now int64) bool {
	c.mu.RLock()
	prompted := c.promptedAt[info.ID]
	settled := c.settledAt[info.ID]
	c.mu.RUnlock()
	if now-prompted < 10_000 && prompted > settled {
		return true
	}
	if !info.Running || info.UpdatedAt <= 0 {
		return false
	}
	return now-info.UpdatedAt < 30*60*1000
}

func (c *Control) toConversations(infos []protocol.ConversationInfo) []Conversation {
	now := time.Now().UnixMilli()
	conversations := make([]Conversation, 0, len(infos))
	for _, info := range infos {
		conversations = append(conversations, Conversation{
			ID:          info.ID,
			Title:       info.Title,
			Root:        info.Root,
			Hidden:      info.Hidden,
			Running:     c.runActive(info, now),
			LastEntryID: info.LastEntryID,
			UpdatedAt:   info.UpdatedAt,
			Tokens:      info.Tokens,
			Cost:        info.Cost,
			Parent:      info.Parent,
			Children:    info.Children,
			Model:       info.Model,
			Thinking:    info.Thinking,
			CreatedBy:   info.CreatedBy,
		})
	}
	return conversations
}

// hasConversation reports whether a conversation is a sensible place to land:
// present, not tombstoned, and not a subagent's transcript.
func hasConversation(infos []protocol.ConversationInfo, id string) bool {
	if id == "" {
		return false
	}
	for _, info := range infos {
		if info.ID == id {
			return !info.Hidden && info.Parent == ""
		}
	}
	return false
}

func firstVisible(infos []protocol.ConversationInfo) string {
	for _, info := range infos {
		if !info.Hidden && info.Parent == "" {
			return info.ID
		}
	}
	return ""
}

// defaultConversation prefers the root conversation, so an upgrade lands on the
// history it already has.
func defaultConversation(infos []protocol.ConversationInfo) string {
	for _, info := range infos {
		if info.Root && !info.Hidden {
			return info.ID
		}
	}
	return firstVisible(infos)
}
