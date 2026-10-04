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
	"strings"
	"sync"

	"github.com/acornfall/acornfall/gateway/internal/protocol"
	"github.com/acornfall/acornfall/gateway/internal/workerpool"
)

// ErrNoProvider means the install has no usable credential yet. It is a state,
// not a failure: the UI has to be reachable so the user can connect one.
var ErrNoProvider = errors.New("no authenticated provider")

// Options configures one Control instance, which owns exactly one workspace.
type Options struct {
	Workspace     string
	DataDir       string
	WorkerCommand []string
	WorkerDir     string
	// Model is the "provider/modelId" to use as the install default. It wins over
	// a persisted default, and every conversation that never chose a model follows it.
	Model string
	// SettingsPath persists the active conversation and per-conversation agents.
	SettingsPath string
}

// Conversation is one transcript, as the UI lists it.
type Conversation struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Root  bool   `json:"root"`
	// Hidden conversations are tombstoned, not deleted; the UI can restore them.
	Hidden bool `json:"hidden"`
}

// State is everything the UI needs to render before any frame arrives.
type State struct {
	Workspace     string                  `json:"workspace"`
	Harness       string                  `json:"harness"`
	Capabilities  protocol.Capabilities   `json:"capabilities"`
	Conversation  *Conversation           `json:"conversation,omitempty"`
	Conversations []Conversation          `json:"conversations"`
	Agent         protocol.ModelBinding   `json:"agent"`
	Resolved      *protocol.ResolvedAgent `json:"resolved,omitempty"`
	// DefaultModel is what a conversation with no explicit model runs.
	DefaultModel protocol.ModelBinding `json:"defaultModel"`
	// ModelInherited is true when the active conversation never chose a model.
	ModelInherited bool                    `json:"modelInherited"`
	Agents         []protocol.AgentSummary `json:"agents"`
	Skills         []protocol.SkillSummary `json:"skills"`
	Defaults       []protocol.LayerTrace   `json:"defaults"`
	Providers      []protocol.ProviderInfo `json:"providers"`
	Seq            int64                   `json:"seq"`
}

type Control struct {
	opts   Options
	worker *workerpool.Worker

	mu            sync.RWMutex
	describe      protocol.Describe
	conversations []protocol.ConversationInfo
	active        string
	// bindings holds only explicit choices, made in a conversation. A conversation
	// with no entry here follows the definition's model or defaultModel.
	bindings     map[string]protocol.ModelBinding
	defaultModel protocol.ModelBinding
	resolved     map[string]*protocol.ResolvedAgent
	catalog      protocol.AgentsData
	providers    []protocol.ProviderInfo
	views        map[string]cachedView
	subscribers  map[int]chan protocol.Frame
	nextSub      int
}

// cachedView is the last full view per conversation, so switching back is
// instant rather than waiting for the worker's next frame.
type cachedView struct {
	value []byte
	seq   int64
}

func New(opts Options) *Control {
	return &Control{
		opts:        opts,
		bindings:    map[string]protocol.ModelBinding{},
		resolved:    map[string]*protocol.ResolvedAgent{},
		views:       map[string]cachedView{},
		subscribers: map[int]chan protocol.Frame{},
	}
}

// Open starts the worker, reads the catalog, and attaches to the active
// conversation, creating the root conversation if the storage is empty.
func (c *Control) Open(ctx context.Context) error {
	command := c.opts.WorkerCommand
	if len(command) == 0 {
		command = []string{"bun", "run", "src/main.ts"}
	}
	worker := workerpool.New(workerpool.Config{
		Command: command[0],
		Args:    command[1:],
		Dir:     c.opts.WorkerDir,
	})
	worker.OnFrame(c.onFrame)
	if err := worker.Start(ctx); err != nil {
		return fmt.Errorf("start worker: %w", err)
	}
	c.worker = worker

	var describe protocol.Describe
	if err := worker.CallInto(ctx, protocol.Command{Type: "describe"}, &describe); err != nil {
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
	defer c.mu.RUnlock()
	state := State{
		Workspace:     c.opts.Workspace,
		Harness:       c.describe.Provider,
		Capabilities:  c.describe.Capabilities,
		Conversations: toConversations(c.conversations),
		// Agent is the effective binding, so pickers show what will actually run;
		// ModelInherited says whether this conversation chose it.
		Agent:          effectiveFrom(c.bindings[c.active], c.defaultModel, c.resolved[c.active]),
		Resolved:       c.resolved[c.active],
		DefaultModel:   c.defaultModel,
		ModelInherited: c.bindings[c.active].Provider == "",
		Agents:         c.catalog.Agents,
		Skills:         c.catalog.Skills,
		Defaults:       c.catalog.Defaults,
		Providers:      c.providers,
		Seq:            c.views[c.active].seq,
	}
	for index := range state.Conversations {
		if state.Conversations[index].ID == c.active {
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
func (c *Control) effective(conversationID string, explicit protocol.ModelBinding) (protocol.ModelBinding, error) {
	c.mu.RLock()
	resolved := c.resolved[conversationID]
	fallback := c.defaultModel
	c.mu.RUnlock()
	effective := effectiveFrom(explicit, fallback, resolved)
	if effective.Provider == "" || effective.ModelID == "" {
		return effective, fmt.Errorf("%w: connect a provider or set a default model", ErrNoProvider)
	}
	return effective, nil
}

// effectiveFrom is the resolution order itself: an explicit choice, then the
// definition's model, then the install default. An empty thinking level is left
// alone, because "whatever the definition says" is the worker's to resolve.
func effectiveFrom(
	explicit protocol.ModelBinding,
	fallback protocol.ModelBinding,
	resolved *protocol.ResolvedAgent,
) protocol.ModelBinding {
	effective := explicit
	if effective.Provider != "" && effective.ModelID != "" {
		return effective
	}
	if resolved != nil {
		if parts := strings.SplitN(resolved.Model, "/", 2); len(parts) == 2 && parts[0] != "" && parts[1] != "" {
			effective.Provider, effective.ModelID = parts[0], parts[1]
			return effective
		}
	}
	effective.Provider, effective.ModelID = fallback.Provider, fallback.ModelID
	return effective
}

// SetDefaultModel changes what conversations without an explicit model run, and
// re-applies it so the change reaches them without a restart.
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

	// Every conversation that never chose follows the new default.
	c.mu.RLock()
	inheriting := make([]string, 0, len(c.bindings))
	for id, binding := range c.bindings {
		if binding.Provider == "" {
			inheriting = append(inheriting, id)
		}
	}
	active := c.active
	c.mu.RUnlock()
	for _, id := range inheriting {
		if err := c.reapply(ctx, id); err != nil {
			return err
		}
	}
	if active != "" && !contains(inheriting, active) {
		if err := c.reapply(ctx, active); err != nil {
			return err
		}
	}
	c.persist()
	c.publish(protocol.Frame{Type: "state"})
	return nil
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
	c.mu.RUnlock()
	if explicit.Provider != "" && c.isAvailable(c.Describe(), explicit) {
		return nil
	}
	return c.reapply(ctx, conversationID)
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
	c.mu.RLock()
	bindings := make(map[string]protocol.ModelBinding, len(c.bindings))
	for id, binding := range c.bindings {
		bindings[id] = binding
	}
	c.mu.RUnlock()
	for id := range bindings {
		if err := c.reapply(ctx, id); err != nil {
			return err
		}
	}
	c.mu.RLock()
	known := make([]string, 0, len(c.conversations))
	for _, conversation := range c.conversations {
		known = append(known, conversation.ID)
	}
	c.mu.RUnlock()
	for _, id := range known {
		if _, ok := bindings[id]; ok {
			continue
		}
		if err := c.reapply(ctx, id); err != nil && !errors.Is(err, ErrNoProvider) {
			return err
		}
	}
	c.publish(protocol.Frame{Type: "state"})
	return nil
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
func (c *Control) Subscribe() (int, <-chan protocol.Frame, *protocol.Frame) {
	c.mu.Lock()
	defer c.mu.Unlock()
	id := c.nextSub
	c.nextSub++
	channel := make(chan protocol.Frame, 1)
	c.subscribers[id] = channel

	var initial *protocol.Frame
	if cached, ok := c.views[c.active]; ok && cached.value != nil {
		frame := protocol.Frame{
			Type:           "view",
			ConversationID: c.active,
			Seq:            cached.seq,
			Value:          append([]byte(nil), cached.value...),
		}
		initial = &frame
	}
	return id, channel, initial
}

func (c *Control) Unsubscribe(id int) {
	c.mu.Lock()
	defer c.mu.Unlock()
	delete(c.subscribers, id)
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
			value: append([]byte(nil), frame.Value...),
			seq:   frame.Seq,
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
	Active       string                           `json:"active,omitempty"`
	DefaultModel protocol.ModelBinding            `json:"defaultModel,omitempty"`
	Agents       map[string]protocol.ModelBinding `json:"agents,omitempty"`
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
		Active:       c.active,
		DefaultModel: c.defaultModel,
		Agents:       map[string]protocol.ModelBinding{},
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
			ID:     info.ID,
			Title:  info.Title,
			Root:   info.Root,
			Hidden: info.Hidden,
		})
	}
	return conversations
}

func hasConversation(infos []protocol.ConversationInfo, id string) bool {
	if id == "" {
		return false
	}
	for _, info := range infos {
		if info.ID == id {
			return !info.Hidden
		}
	}
	return false
}

func firstVisible(infos []protocol.ConversationInfo) string {
	for _, info := range infos {
		if !info.Hidden {
			return info.ID
		}
	}
	return ""
}

// defaultConversation prefers the root conversation, so an upgrade lands on the
// history it already has.
func defaultConversation(infos []protocol.ConversationInfo) string {
	for _, info := range infos {
		if info.Root {
			return info.ID
		}
	}
	return firstVisible(infos)
}
