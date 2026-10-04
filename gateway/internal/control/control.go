// Package control owns the domain: workspace, session, agent binding, worker
// lifecycle, and the fan-out of worker frames to attached clients.
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

const RootConversationID = "root"

// Options configures one Control instance, which owns exactly one workspace.
type Options struct {
	Workspace     string
	DataDir       string
	WorkerCommand []string
	WorkerDir     string
	// Model is the default "provider/modelId". Empty selects the stored
	// selection, then the first model of the first authenticated provider.
	Model string
	// SettingsPath persists the session's agent binding across restarts.
	SettingsPath string
}

// Session is a conversation as the user sees it.
type Session struct {
	ID    string `json:"id"`
	Title string `json:"title"`
}

// State is everything the UI needs to render before any frame arrives.
type State struct {
	Workspace    string                  `json:"workspace"`
	Harness      string                  `json:"harness"`
	Capabilities protocol.Capabilities   `json:"capabilities"`
	Session      Session                 `json:"session"`
	Agent        protocol.ModelBinding   `json:"agent"`
	Providers    []protocol.ProviderInfo `json:"providers"`
	Seq          int64                   `json:"seq"`
}

type Control struct {
	opts   Options
	worker *workerpool.Worker

	mu          sync.RWMutex
	describe    protocol.Describe
	agent       protocol.ModelBinding
	seq         int64
	lastView    []byte
	providers   []protocol.ProviderInfo
	subscribers map[int]chan protocol.Frame
	nextSub     int
}

func New(opts Options) *Control {
	return &Control{
		opts:        opts,
		subscribers: map[int]chan protocol.Frame{},
		agent:       protocol.ModelBinding{Provider: "opencode-go", ModelID: ""},
	}
}

// Open starts the worker, resolves a default model, and attaches to the session.
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

	// An unauthenticated install still serves the UI, so a provider can be
	// connected from it. Only a real worker failure is fatal here.
	binding, err := c.defaultBinding(describe)
	if errors.Is(err, ErrNoProvider) {
		workerpool.Log("no provider connected yet; open the UI to connect one")
		return nil
	}
	if err != nil {
		return err
	}
	return c.SetAgent(ctx, binding)
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
	return State{
		Workspace:    c.opts.Workspace,
		Harness:      c.describe.Provider,
		Capabilities: c.describe.Capabilities,
		Session:      Session{ID: RootConversationID, Title: baseName(c.opts.Workspace)},
		Agent:        c.agent,
		Providers:    c.providers,
		Seq:          c.seq,
	}
}

// SetAgent applies a model binding and selects it for the session.
// Refresh re-reads the worker's provider catalog and adopts a usable agent
// binding when the current one is missing or no longer available.
func (c *Control) Refresh(ctx context.Context) error {
	var describe protocol.Describe
	if err := c.worker.CallInto(ctx, protocol.Command{Type: "describe"}, &describe); err != nil {
		return err
	}
	c.applyDescribe(describe)

	c.mu.RLock()
	current := c.agent
	c.mu.RUnlock()
	if current.ModelID != "" && c.isAvailable(describe, current) {
		return nil
	}
	binding, err := c.defaultBinding(describe)
	if err != nil {
		return err
	}
	return c.SetAgent(ctx, binding)
}

// Login runs a provider login flow in the worker. It returns as soon as the
// flow starts: the interaction arrives as `auth` frames, and a device flow can
// take minutes.
func (c *Control) Login(ctx context.Context, providerID, authType string) error {
	authID := fmt.Sprintf("auth-%d", c.nextSub+1)
	c.mu.Lock()
	c.nextSub++
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

// Logout forgets one provider's stored credential and re-adopts a binding, so a
// revoked key cannot keep spending and the picker cannot keep offering it.
func (c *Control) Logout(ctx context.Context, providerID string) error {
	if _, err := c.worker.Call(ctx, protocol.Command{Type: "logout", ProviderID: providerID}); err != nil {
		return err
	}
	// Drop the binding first, then let Refresh adopt whatever is still usable.
	c.mu.Lock()
	if c.agent.Provider == providerID {
		c.agent = protocol.ModelBinding{}
	}
	c.mu.Unlock()
	if err := c.Refresh(ctx); err != nil && !errors.Is(err, ErrNoProvider) {
		return err
	}
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

func (c *Control) SetAgent(ctx context.Context, binding protocol.ModelBinding) error {
	if err := c.worker.CallInto(ctx, protocol.Command{
		Type:           "open",
		ConversationID: RootConversationID,
		Agent:          &binding,
	}, nil); err != nil {
		return err
	}
	c.mu.Lock()
	c.agent = binding
	c.mu.Unlock()
	c.persist(binding)
	return nil
}

func (c *Control) Prompt(ctx context.Context, text string, when protocol.WhenBusy) error {
	if strings.TrimSpace(text) == "" {
		return fmt.Errorf("empty message")
	}
	return c.worker.CallInto(ctx, protocol.Command{
		Type:           "prompt",
		ConversationID: RootConversationID,
		Text:           text,
		WhenBusy:       when,
	}, nil)
}

func (c *Control) Abort(ctx context.Context) error {
	return c.worker.CallInto(ctx, protocol.Command{
		Type:           "abort",
		ConversationID: RootConversationID,
	}, nil)
}

func (c *Control) Usage(ctx context.Context) (json.RawMessage, error) {
	return c.worker.Call(ctx, protocol.Command{Type: "usage"})
}

// Subscribe attaches a client. It returns the current view frame, if any, so a
// late joiner starts from committed state and never from an empty screen.
func (c *Control) Subscribe() (int, <-chan protocol.Frame, *protocol.Frame) {
	c.mu.Lock()
	defer c.mu.Unlock()
	id := c.nextSub
	c.nextSub++
	channel := make(chan protocol.Frame, 1)
	c.subscribers[id] = channel
	var initial *protocol.Frame
	if c.lastView != nil {
		frame := c.lastViewFrame()
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
}

// publish fans one frame out to attached clients. A view frame is a complete
// value, so the newest supersedes any undelivered older one; a slow client loses
// frames, never state.
func (c *Control) publish(frame protocol.Frame) {
	c.mu.Lock()
	if frame.Type == "view" {
		c.seq = frame.Seq
		c.lastView = append(c.lastView[:0], frame.Value...)
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

func (c *Control) lastViewFrame() protocol.Frame {
	return protocol.Frame{
		Type:           "view",
		ConversationID: RootConversationID,
		Seq:            c.seq,
		Value:          append([]byte(nil), c.lastView...),
	}
}

func (c *Control) applyDescribe(describe protocol.Describe) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.describe = describe
	c.providers = describe.Providers
}

func (c *Control) defaultBinding(describe protocol.Describe) (protocol.ModelBinding, error) {
	if model := strings.TrimSpace(c.opts.Model); model != "" {
		parts := strings.SplitN(model, "/", 2)
		if len(parts) != 2 {
			return protocol.ModelBinding{}, fmt.Errorf("--model must be provider/modelId, got %q", model)
		}
		return protocol.ModelBinding{Provider: parts[0], ModelID: parts[1]}, nil
	}
	if stored, ok := c.loadPersistedAgent(); ok && c.isAvailable(describe, stored) {
		return stored, nil
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
	Agent protocol.ModelBinding `json:"agent"`
}

func (c *Control) loadPersistedAgent() (protocol.ModelBinding, bool) {
	if c.opts.SettingsPath == "" {
		return protocol.ModelBinding{}, false
	}
	payload, err := os.ReadFile(c.opts.SettingsPath)
	if err != nil {
		return protocol.ModelBinding{}, false
	}
	var settings persistedSettings
	if err := json.Unmarshal(payload, &settings); err != nil {
		return protocol.ModelBinding{}, false
	}
	if settings.Agent.Provider == "" || settings.Agent.ModelID == "" {
		return protocol.ModelBinding{}, false
	}
	return settings.Agent, true
}

func (c *Control) persist(binding protocol.ModelBinding) {
	if c.opts.SettingsPath == "" {
		return
	}
	payload, err := json.MarshalIndent(persistedSettings{Agent: binding}, "", "  ")
	if err != nil {
		return
	}
	temp := c.opts.SettingsPath + ".tmp"
	if err := os.WriteFile(temp, append(payload, '\n'), 0o600); err != nil {
		return
	}
	_ = os.Rename(temp, c.opts.SettingsPath)
}

func baseName(path string) string {
	trimmed := strings.TrimRight(path, "/")
	if trimmed == "" {
		return path
	}
	if index := strings.LastIndex(trimmed, "/"); index >= 0 {
		return trimmed[index+1:]
	}
	return trimmed
}
