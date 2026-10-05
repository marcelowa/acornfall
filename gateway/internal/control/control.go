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
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/acornfall/acornfall/gateway/internal/protocol"
	"github.com/acornfall/acornfall/gateway/internal/workerpool"
)

// ErrNoProvider means the install has no usable credential yet. It is a state,
// not a failure: the UI has to be reachable so the user can connect one.
var ErrNoProvider = errors.New("no authenticated provider")

// Options configures one Control instance, which owns exactly one workspace.
type Options struct {
	// Workspace is the folder, name, and trust decision this Control serves.
	Workspace Workspace
	// Home is the installation folder: global resources and shared credentials.
	Home string
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
}

// WorkspaceState is a workspace as the interface needs it: what it is called, where it
// points, whether its own resources are trusted, and whether its worker is running.
type WorkspaceState struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	Title   string `json:"title"`
	General bool   `json:"general"`
	Trusted bool   `json:"trusted"`
	Running bool   `json:"running"`
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
	// Running, LastEntryID, Tokens, and Cost are live state for the rail.
	Running     bool    `json:"running"`
	LastEntryID string  `json:"lastEntryId"`
	Tokens      float64 `json:"tokens"`
	Cost        float64 `json:"cost"`
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
	// Defaults apply to conversations that never chose, and to new ones.
	DefaultModel    protocol.ModelBinding `json:"defaultModel"`
	DefaultThinking string                `json:"defaultThinking"`
	DefaultAgent    string                `json:"defaultAgent"`
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
	WorkerUp    bool                    `json:"workerUp"`
	WorkerError string                  `json:"workerError,omitempty"`
	Agents      []protocol.AgentSummary `json:"agents"`
	Skills      []protocol.SkillSummary `json:"skills"`
	Defaults    []protocol.LayerTrace   `json:"defaults"`
	Providers   []protocol.ProviderInfo `json:"providers"`
	Seq         int64                   `json:"seq"`
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
	// One notification per death, drained by the single supervisor loop. A restart loop
	// per death would compound: every failed attempt is another death.
	workerExited chan struct{}
	// bindings holds only explicit choices, made in a conversation. A conversation
	// with no entry here follows the definition's model or defaultModel.
	bindings        map[string]protocol.ModelBinding
	defaultModel    protocol.ModelBinding
	defaultThinking string
	defaultAgent    string
	resolved        map[string]*protocol.ResolvedAgent
	catalog         protocol.AgentsData
	providers       []protocol.ProviderInfo
	policies        map[string]json.RawMessage
	views           map[string]cachedView
	subscribers     map[int]chan protocol.Frame
	nextSub         int
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
		subscriberConversation: map[int]string{},
		attachments:            map[string]int{},
		policies:               map[string]json.RawMessage{},
	}
}

// Open starts the worker, reads the catalog, and attaches to the active
// conversation, creating the root conversation if the storage is empty.
func (c *Control) Open(ctx context.Context) error {
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
	// Our own state first: it holds the default model this install already uses.
	persistedActive := c.loadSettings()
	if err := c.ensureDefault(ctx); err != nil && !errors.Is(err, ErrNoProvider) {
		return fmt.Errorf("resolve default model: %w", err)
	}
	conversations, err := c.listConversations(ctx)
	if err != nil {
		return fmt.Errorf("list conversations: %w", err)
	}
	if len(conversations) == 0 {
		if err := c.Create(ctx); err != nil {
			return fmt.Errorf("create first conversation: %w", err)
		}
		go c.watchConversations(ctx)
		go c.supervise(ctx)
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
	go c.watchConversations(ctx)
	go c.supervise(ctx)
	return nil
}

// startWorker launches the harness process and arranges for its death to be noticed.
func (c *Control) startWorker(ctx context.Context) error {
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
		// Whether this workspace's own resources may be read at all. Passed to the worker
		// rather than enforced here, because the worker is what reads the files.
		"--trusted", strconv.FormatBool(c.opts.Workspace.Trusted),
	)
	worker := workerpool.New(workerpool.Config{Command: base[0], Args: args, Dir: c.opts.WorkerDir})
	worker.OnFrame(c.onFrame)
	if err := worker.Start(ctx); err != nil {
		return fmt.Errorf("start worker: %w", err)
	}
	c.mu.Lock()
	c.worker = worker
	c.workerUp = true
	c.workerError = ""
	c.mu.Unlock()
	worker.OnExit(func(err error) { c.workerDied(err) })
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
func (c *Control) workerDied(err error) {
	reason := "the harness process ended"
	if err != nil {
		reason = fmt.Sprintf("the harness process ended: %v", err)
	}
	c.mu.Lock()
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
	active := c.activeConversation()
	if active != "" {
		var response struct {
			ConversationID string `json:"conversationId"`
		}
		if err := c.worker.CallInto(ctx, protocol.Command{
			Type:           "attach",
			ConversationID: active,
		}, &response); err != nil {
			return err
		}
	} else if err := c.createFirstConversation(ctx); err != nil {
		return err
	}
	if _, err := c.listConversations(ctx); err != nil {
		return err
	}
	if active == "" {
		c.mu.RLock()
		active = c.active
		c.mu.RUnlock()
	}
	if active != "" {
		if err := c.ensureConversation(ctx, active); err != nil && !errors.Is(err, ErrNoProvider) {
			workerpool.Log("re-apply agent after restart: %v", err)
		}
	}
	c.publish(protocol.Frame{Type: "state"})
	return nil
}

// createFirstConversation is the empty-install path, shared by Open and recovery.
func (c *Control) createFirstConversation(ctx context.Context) error {
	return c.Create(ctx)
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
			if !c.hasSubscribers() {
				continue
			}
			before := c.conversationSignature()
			if _, err := c.listConversations(ctx); err != nil {
				continue
			}
			if c.conversationSignature() != before {
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

func (c *Control) hasSubscribers() bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	return len(c.subscribers) > 0
}

func (c *Control) conversationSignature() string {
	c.mu.RLock()
	defer c.mu.RUnlock()
	var builder strings.Builder
	for _, info := range c.conversations {
		fmt.Fprintf(&builder, "%s:%t:%s:%.0f|", info.ID, info.Running, info.LastEntryID, info.Tokens)
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
	return len(c.views) > 0 && c.workerUp && false
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
	if c.worker != nil {
		c.worker.Close()
	}
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
		c.mu.RLock()
		for _, info := range c.conversations {
			if info.ID != active {
				continue
			}
			if info.Model != "" {
				parts := strings.SplitN(info.Model, "/", 2)
				if len(parts) == 2 {
					inputs.explicit.Provider, inputs.explicit.ModelID = parts[0], parts[1]
				}
			}
			if info.Thinking != "" {
				inputs.explicit.ThinkingLevel = info.Thinking
			}
			break
		}
		c.mu.RUnlock()
	}

	// The registry lock is taken before this snapshot's, never inside it. The eviction sweep
	// takes the registry lock and then reads a control, so a state build that read the
	// registry from inside this lock would close the cycle and hang every request behind
	// it. Read it first, and the two orders agree.
	workspaces := c.workspaceList()

	c.mu.RLock()
	defer c.mu.RUnlock()
	state := State{
		Workspace: WorkspaceState{
			Name:    c.opts.Workspace.Name,
			Path:    c.opts.Workspace.Path,
			Title:   c.opts.Workspace.Title,
			General: c.opts.Workspace.General,
			Trusted: c.opts.Workspace.Trusted,
			Running: c.workerUp,
		},
		Workspaces:    workspaces,
		WorkspacesDir: c.opts.WorkspacesDir,
		Harness:       c.describe.Provider,
		Capabilities:  c.describe.Capabilities,
		Conversations: toConversations(c.conversations),
		// Agent is the effective binding, so pickers show what will actually run;
		// Inherited says which parts of it this conversation chose itself.
		Agent:           inputs.effective(),
		Subagent:        isChild,
		Resolved:        c.resolved[active],
		DefaultModel:    c.defaultModel,
		DefaultThinking: c.defaultThinking,
		DefaultAgent:    c.defaultAgent,
		WorkerUp:        c.workerUp,
		WorkerError:     c.workerError,
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
	return nil
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
		explicit.Provider, explicit.ModelID = provider, modelID
	}
	if change.Definition != nil {
		explicit.Definition = *change.Definition
	}
	if change.ThinkingLevel != nil {
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
		if parts := strings.SplitN(in.resolved.Model, "/", 2); len(parts) == 2 && parts[0] != "" && parts[1] != "" {
			return parts[0], parts[1]
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
	return effective
}

func (c *Control) inputsFor(conversationID string) resolveInputs {
	c.mu.RLock()
	inputs := resolveInputs{
		explicit:        c.bindings[conversationID],
		fallbackModel:   c.defaultModel,
		defaultThinking: c.defaultThinking,
		defaultAgent:    c.defaultAgent,
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
	if level != "" && !contains(thinkingLevels, level) {
		return fmt.Errorf("unknown thinking level %q; expected one of %s", level, strings.Join(thinkingLevels, ", "))
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

// SetDefaultModel changes what conversations without an explicit model run.
func (c *Control) SetDefaultModel(ctx context.Context, provider, modelID string) error {
	if provider == "" || modelID == "" {
		return errors.New("provider and modelId are required")
	}
	if !c.isAvailable(c.Describe(), protocol.ModelBinding{Provider: provider, ModelID: modelID}) {
		return fmt.Errorf("%s/%s is not available with the current credentials", provider, modelID)
	}
	c.mu.Lock()
	c.defaultModel = protocol.ModelBinding{Provider: provider, ModelID: modelID}
	c.mu.Unlock()
	return c.reapplyInheriting(ctx)
}

// ensureDefault gives the install a default model when it has none or when the
// stored one is no longer available, so the first prompt always has something.
func (c *Control) ensureDefault(ctx context.Context) error {
	describe := c.Describe()
	c.mu.RLock()
	current := c.defaultModel
	c.mu.RUnlock()
	if current.Provider != "" && c.isAvailable(describe, current) {
		return nil
	}
	binding, err := c.deriveDefault(describe)
	if err != nil {
		return err
	}
	c.mu.Lock()
	c.defaultModel = binding
	c.mu.Unlock()
	c.persist()
	return nil
}

// ensureConversation configures a conversation that has no explicit model, so it
// can run, without making the default an explicit choice it never made.
func (c *Control) ensureConversation(ctx context.Context, conversationID string) error {
	c.mu.RLock()
	explicit := c.bindings[conversationID]
	for _, info := range c.conversations {
		if info.ID == conversationID && info.Parent != "" {
			// A subagent is configured by whatever created it. Re-applying a binding
			// here would overwrite that with the install default.
			c.mu.RUnlock()
			return nil
		}
	}
	c.mu.RUnlock()
	if explicit.Provider != "" && c.isAvailable(c.Describe(), explicit) {
		return nil
	}
	return c.reapply(ctx, conversationID)
}

// isSubagent reports whether a conversation was created by another one.
func (c *Control) isSubagent(conversationID string) bool {
	c.mu.RLock()
	defer c.mu.RUnlock()
	for _, info := range c.conversations {
		if info.ID == conversationID {
			return info.Parent != ""
		}
	}
	return false
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
	for _, value := range values {
		if value == wanted {
			return true
		}
	}
	return false
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
	// A definition may have been renamed or removed: stop pointing at one that is
	// gone rather than failing every conversation that inherited it.
	c.mu.Lock()
	if c.defaultAgent != "" {
		stillThere := false
		for _, agent := range c.catalog.Agents {
			if agent.Name == c.defaultAgent {
				stillThere = true
				break
			}
		}
		if !stillThere {
			workerpool.Log("default agent %q is gone; falling back to the layered defaults", c.defaultAgent)
			c.defaultAgent = ""
		}
	}
	c.mu.Unlock()
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
	if err := c.ensureDefault(ctx); err != nil && !errors.Is(err, ErrNoProvider) {
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
	return c.worker.CallInto(ctx, protocol.Command{
		Type:           "prompt",
		ConversationID: conversationID,
		Text:           text,
		WhenBusy:       when,
	}, nil)
}

func (c *Control) Abort(ctx context.Context, conversationID string) error {
	return c.worker.CallInto(ctx, protocol.Command{Type: "abort", ConversationID: conversationID}, nil)
}

func (c *Control) Usage(ctx context.Context) (json.RawMessage, error) {
	return c.worker.Call(ctx, protocol.Command{Type: "usage"})
}

// Subscribe attaches a client. It returns the active conversation's current
// view, if any, so a late joiner starts from committed state.
// Subscribe attaches one client to one conversation. An empty id means the
// conversation this install last used, which is what a fresh tab lands on.
func (c *Control) Subscribe(ctx context.Context, conversationID string) (int, <-chan protocol.Frame, *protocol.Frame, error) {
	c.mu.Lock()
	if conversationID == "" {
		conversationID = c.active
	}
	first := c.attachments[conversationID] == 0
	c.attachments[conversationID] += 1
	id := c.nextSub
	c.nextSub++
	channel := make(chan protocol.Frame, 1)
	c.subscribers[id] = channel
	c.subscriberConversation[id] = conversationID
	// The newest watcher decides what a new tab opens on.
	if conversationID != "" {
		c.active = conversationID
	}
	cached, hasCache := c.views[conversationID]
	c.mu.Unlock()

	// The worker subscribes per conversation, so the first watcher is what asks for it.
	if first && conversationID != "" {
		if _, err := c.worker.Call(ctx, protocol.Command{Type: "attach", ConversationID: conversationID}); err != nil {
			c.Unsubscribe(id)
			return 0, nil, nil, err
		}
		// Fetch its policy now rather than leaving a client to see state without one until
		// the next refresh tick, which reads as a broken inspector for a few seconds.
		if policy, err := c.worker.Call(ctx, protocol.Command{Type: "policy", ConversationID: conversationID}); err == nil {
			c.mu.Lock()
			c.policies[conversationID] = policy
			c.mu.Unlock()
		}
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
	return id, channel, initial, nil
}

// Unsubscribe releases one client. The worker is told to stop watching only when the last
// watcher of that conversation leaves, and never for the one this install remembers.
func (c *Control) Unsubscribe(id int) {
	c.mu.Lock()
	conversationID := c.subscriberConversation[id]
	delete(c.subscribers, id)
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
	// moment a conversation's name can change.
	if frame.Type == "submission" {
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

// publish fans one frame out to attached clients. A view frame is a complete
// value, so the newest supersedes any undelivered older one; a slow client loses
// frames, never state.
func (c *Control) publish(frame protocol.Frame) {
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

	// One extra worker call per refresh, for the active conversation only: the
	// delegation card is always about the conversation in front of you.
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

// deriveDefault picks a default: the flag, then the first authenticated provider's
// first model. Guessing is fine once, but it is stored so it stops being a guess.
func (c *Control) deriveDefault(describe protocol.Describe) (protocol.ModelBinding, error) {
	if model := strings.TrimSpace(c.opts.Model); model != "" {
		parts := strings.SplitN(model, "/", 2)
		if len(parts) != 2 {
			return protocol.ModelBinding{}, fmt.Errorf("--model must be provider/modelId, got %q", model)
		}
		return protocol.ModelBinding{Provider: parts[0], ModelID: parts[1]}, nil
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
	DefaultModel    protocol.ModelBinding            `json:"defaultModel,omitempty"`
	DefaultThinking string                           `json:"defaultThinking,omitempty"`
	DefaultAgent    string                           `json:"defaultAgent,omitempty"`
	Agents          map[string]protocol.ModelBinding `json:"agents,omitempty"`
}

// loadSettings reads our own state: the default model, the active conversation,
// and which conversations chose a model. It must run before ensureDefault, or
// ensureDefault derives a default and overwrites the one on disk.
func (c *Control) loadSettings() string {
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
	settings := persistedSettings{
		Active:          c.active,
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

func toConversations(infos []protocol.ConversationInfo) []Conversation {
	conversations := make([]Conversation, 0, len(infos))
	for _, info := range infos {
		conversations = append(conversations, Conversation{
			ID:          info.ID,
			Title:       info.Title,
			Root:        info.Root,
			Hidden:      info.Hidden,
			Running:     info.Running,
			LastEntryID: info.LastEntryID,
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
