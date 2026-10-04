// Package protocol is the Go side of the worker wire protocol.
// See docs/adr/0002-layers-and-protocol.md.
package protocol

import "encoding/json"

type WhenBusy string

const (
	// WhenBusyFollowUp places the message when the current run answers.
	WhenBusyFollowUp WhenBusy = "followUp"
	// WhenBusySteer places the message after the current tool round, inside the run.
	WhenBusySteer WhenBusy = "steer"
	// WhenBusyReject fails instead of queueing when the session is busy.
	WhenBusyReject WhenBusy = "reject"
)

type ModelBinding struct {
	Provider      string `json:"provider"`
	ModelID       string `json:"modelId"`
	ThinkingLevel string `json:"thinkingLevel,omitempty"`
	// ThinkingRequested is the level that was asked for when the model could not
	// honour it, so the UI can show why the applied level differs.
	ThinkingRequested string `json:"thinkingRequested,omitempty"`
	Instructions      string `json:"instructions,omitempty"`
	// Definition names an agent definition; empty selects the layered defaults only.
	Definition string `json:"definition,omitempty"`
}

// Command is a request from control to the worker.
type Command struct {
	ID             string        `json:"id"`
	Type           string        `json:"type"`
	ConversationID string        `json:"conversationId,omitempty"`
	Agent          *ModelBinding `json:"agent,omitempty"`
	Text           string        `json:"text,omitempty"`
	WhenBusy       WhenBusy      `json:"whenBusy,omitempty"`
	Title          string        `json:"title,omitempty"`
	// No omitempty: `false` is a value here, and omitting it turns a restore into
	// a no-op that still reports success.
	Hidden     bool   `json:"hidden"`
	At         string `json:"at,omitempty"`
	AuthID     string `json:"authId,omitempty"`
	ProviderID string `json:"providerId,omitempty"`
	AuthType   string `json:"authType,omitempty"`
	PromptID   string `json:"promptId,omitempty"`
	Value      string `json:"value,omitempty"`
	Cancelled  bool   `json:"cancelled,omitempty"`
}

func (c Command) Marshal() ([]byte, error) { return json.Marshal(c) }

// AuthEventKind enumerates the login interaction events, a 1:1 projection of
// pi-ai's AuthPrompt and AuthEvent.
type AuthEvent struct {
	Kind             string       `json:"kind"`
	PromptID         string       `json:"promptId,omitempty"`
	PromptType       string       `json:"promptType,omitempty"`
	Message          string       `json:"message,omitempty"`
	Placeholder      string       `json:"placeholder,omitempty"`
	Options          []AuthOption `json:"options,omitempty"`
	URL              string       `json:"url,omitempty"`
	Links            []AuthLink   `json:"links,omitempty"`
	Instructions     string       `json:"instructions,omitempty"`
	UserCode         string       `json:"userCode,omitempty"`
	VerificationURI  string       `json:"verificationUri,omitempty"`
	IntervalSeconds  int          `json:"intervalSeconds,omitempty"`
	ExpiresInSeconds int          `json:"expiresInSeconds,omitempty"`
	ProviderID       string       `json:"providerId,omitempty"`
}

type AuthOption struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Description string `json:"description,omitempty"`
}

type AuthLink struct {
	URL   string `json:"url"`
	Label string `json:"label,omitempty"`
}

// Frame is an unprompted message from the worker to control.
type Frame struct {
	Type           string          `json:"type"`
	ID             string          `json:"id,omitempty"`
	OK             bool            `json:"ok,omitempty"`
	Error          string          `json:"error,omitempty"`
	Data           json.RawMessage `json:"data,omitempty"`
	ConversationID string          `json:"conversationId,omitempty"`
	Seq            int64           `json:"seq,omitempty"`
	Value          json.RawMessage `json:"value,omitempty"`
	SubmissionID   string          `json:"submissionId,omitempty"`
	Status         string          `json:"status,omitempty"`
	AuthID         string          `json:"authId,omitempty"`
	Event          *AuthEvent      `json:"event,omitempty"`
}

// LayerTrace records which layer contributed what, so a resolved agent can be
// explained rather than guessed at. Contributes stays raw: it is the layer's
// own contribution document, not a normalized form.
type LayerTrace struct {
	Layer       string          `json:"layer"`
	Path        string          `json:"path"`
	Contributes json.RawMessage `json:"contributes,omitempty"`
}

// ResolvedAgent is one agent after the overlay folded global, workspace, and
// definition layers together.
type ResolvedAgent struct {
	Name         string       `json:"name"`
	Description  string       `json:"description,omitempty"`
	Source       string       `json:"source,omitempty"`
	Model        string       `json:"model,omitempty"`
	Thinking     string       `json:"thinking,omitempty"`
	Instructions string       `json:"instructions,omitempty"`
	Skills       []string     `json:"skills"`
	AllowTools   []string     `json:"allowTools,omitempty"`
	DenyTools    []string     `json:"denyTools,omitempty"`
	Layers       []LayerTrace `json:"layers"`
}

// AgentSummary is one selectable definition.
type AgentSummary struct {
	Name        string        `json:"name"`
	Description string        `json:"description,omitempty"`
	Source      string        `json:"source"`
	Layer       string        `json:"layer"`
	Resolved    ResolvedAgent `json:"resolved"`
}

// SkillSummary is one discovered skill, for the picker and the explain view.
type SkillSummary struct {
	Name        string `json:"name"`
	Description string `json:"description"`
}

// AgentsData is the worker's overlay catalog.
type AgentsData struct {
	Defaults []LayerTrace   `json:"defaults"`
	Skills   []SkillSummary `json:"skills"`
	Agents   []AgentSummary `json:"agents"`
}

// ModelInfo is one model available under an authenticated provider.
type ModelInfo struct {
	ID            string `json:"id"`
	Name          string `json:"name"`
	ContextWindow int    `json:"contextWindow,omitempty"`
	// ThinkingLevels are the levels this model actually supports; ["off"] means
	// it cannot reason at all, so the UI never offers a level that is a lie.
	ThinkingLevels []string `json:"thinkingLevels,omitempty"`
}

// ConversationInfo is one conversation as the worker lists it. The id is the
// harness's own, stringified, and is opaque to this layer.
type ConversationInfo struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	Root  bool   `json:"root"`
	// Hidden conversations are tombstoned, not deleted: storage is append-only,
	// so the UI filters them and can always bring one back.
	Hidden bool `json:"hidden,omitempty"`
}

// ProviderInfo is one model provider and its auth state.
type ProviderInfo struct {
	ID            string      `json:"id"`
	Name          string      `json:"name"`
	Authenticated bool        `json:"authenticated"`
	Source        string      `json:"source,omitempty"`
	Models        []ModelInfo `json:"models"`
}

// Capabilities reports optional worker features so the UI never assumes.
type Capabilities struct {
	Steer     bool   `json:"steer"`
	Subagents bool   `json:"subagents"`
	Sandbox   string `json:"sandbox"`
}

// Describe is the worker's self-report.
type Describe struct {
	Provider     string         `json:"provider"`
	Workdir      string         `json:"workdir"`
	Providers    []ProviderInfo `json:"providers"`
	Capabilities Capabilities   `json:"capabilities"`
}
