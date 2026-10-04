// Package httpapi is the transport edge. It forwards frames it does not
// interpret and never decides anything about the agent.
package httpapi

import (
	"encoding/json"
	"io"
	"io/fs"
	"net/http"
	"strings"

	"github.com/acornfall/acornfall/gateway/internal/control"
	"github.com/acornfall/acornfall/gateway/internal/protocol"
)

type Server struct {
	control *control.Control
	static  fs.FS
}

func New(ctl *control.Control, static fs.FS) *Server {
	return &Server{control: ctl, static: static}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/state", s.state)
	mux.HandleFunc("GET /api/conversations", s.conversations)
	mux.HandleFunc("POST /api/conversations", s.createConversation)
	mux.HandleFunc("POST /api/conversations/{id}/select", s.selectConversation)
	mux.HandleFunc("POST /api/conversations/{id}/rename", s.renameConversation)
	mux.HandleFunc("POST /api/conversations/{id}/hide", s.hideConversation)
	mux.HandleFunc("POST /api/conversations/{id}/fork", s.forkConversation)
	mux.HandleFunc("GET /api/conversations/{id}/policy", s.policy)
	mux.HandleFunc("GET /api/agents", s.agents)
	mux.HandleFunc("POST /api/agents/reload", s.reload)
	mux.HandleFunc("GET /api/stream", s.stream)
	mux.HandleFunc("POST /api/conversations/{id}/messages", s.messages)
	mux.HandleFunc("POST /api/conversations/{id}/abort", s.abort)
	mux.HandleFunc("POST /api/conversations/{id}/agent", s.agent)
	mux.HandleFunc("POST /api/default-model", s.setDefaultModel)
	mux.HandleFunc("POST /api/default-thinking", s.setDefaultThinking)
	mux.HandleFunc("POST /api/default-agent", s.setDefaultAgent)
	mux.HandleFunc("GET /api/usage", s.usage)
	mux.HandleFunc("POST /api/providers/login", s.login)
	mux.HandleFunc("POST /api/providers/logout", s.logout)
	mux.HandleFunc("POST /api/providers/refresh", s.refresh)
	mux.HandleFunc("POST /api/auth/answer", s.authAnswer)
	mux.HandleFunc("POST /api/auth/cancel", s.authCancel)
	mux.Handle("GET /", noCache(http.FileServerFS(s.static)))
	return mux
}

// noCache keeps a reload honest while the client has no build step and no
// content hashes: a stale bundle is indistinguishable from a broken one.
func noCache(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		next.ServeHTTP(w, r)
	})
}

func (s *Server) state(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, s.control.State())
}

// stream is SSE. Commands are POSTs; this direction is the only streaming one,
// so a reconnect is built in and no socket library is needed.
func (s *Server) stream(w http.ResponseWriter, r *http.Request) {
	flusher, ok := w.(http.Flusher)
	if !ok {
		http.Error(w, "streaming unsupported", http.StatusInternalServerError)
		return
	}
	headers := w.Header()
	headers.Set("Content-Type", "text/event-stream")
	headers.Set("Cache-Control", "no-cache")
	headers.Set("Connection", "keep-alive")
	headers.Set("X-Accel-Buffering", "no")
	w.WriteHeader(http.StatusOK)

	id, frames, initial := s.control.Subscribe()
	defer s.control.Unsubscribe(id)

	if err := writeEvent(w, "state", s.control.State()); err != nil {
		return
	}
	if initial != nil {
		if err := writeEvent(w, "frame", *initial); err != nil {
			return
		}
	}
	flusher.Flush()

	for {
		select {
		case <-r.Context().Done():
			return
		case frame := <-frames:
			if err := writeEvent(w, "frame", frame); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func (s *Server) agents(w http.ResponseWriter, r *http.Request) {
	data, err := s.control.Agents(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusOK, data)
}

func (s *Server) reload(w http.ResponseWriter, r *http.Request) {
	if err := s.control.Reload(r.Context()); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusOK, s.control.State())
}

func (s *Server) messages(w http.ResponseWriter, r *http.Request) {
	s.messagesFor(w, r, r.PathValue("id"))
}

func (s *Server) messagesFor(w http.ResponseWriter, r *http.Request, conversationID string) {
	var body struct {
		Text     string            `json:"text"`
		WhenBusy protocol.WhenBusy `json:"whenBusy"`
	}
	if !decode(w, r, &body) {
		return
	}
	when := body.WhenBusy
	switch when {
	case protocol.WhenBusySteer, protocol.WhenBusyReject, protocol.WhenBusyFollowUp:
	case "":
		when = protocol.WhenBusyFollowUp
	default:
		http.Error(w, "whenBusy must be steer, followUp or reject", http.StatusBadRequest)
		return
	}
	if err := s.control.Prompt(r.Context(), conversationID, strings.TrimSpace(body.Text), when); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "accepted"})
}

func (s *Server) abort(w http.ResponseWriter, r *http.Request) {
	s.abortFor(w, r, r.PathValue("id"))
}

func (s *Server) abortFor(w http.ResponseWriter, r *http.Request, conversationID string) {
	if err := s.control.Abort(r.Context(), conversationID); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "aborted"})
}

func (s *Server) agent(w http.ResponseWriter, r *http.Request) {
	s.agentFor(w, r, r.PathValue("id"))
}

func (s *Server) agentFor(w http.ResponseWriter, r *http.Request, conversationID string) {
	// Pointers, so "absent" and "set to empty" are different requests. A plain
	// struct cannot tell "leave the model alone" from "clear the model".
	var body struct {
		Provider      *string `json:"provider"`
		ModelID       *string `json:"modelId"`
		ThinkingLevel *string `json:"thinkingLevel"`
		Definition    *string `json:"definition"`
	}
	if !decode(w, r, &body) {
		return
	}
	if err := s.control.SetAgent(r.Context(), conversationID, control.AgentChange{
		Provider:      body.Provider,
		ModelID:       body.ModelID,
		ThinkingLevel: body.ThinkingLevel,
		Definition:    body.Definition,
	}); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusOK, s.control.State())
}

func (s *Server) setDefaultThinking(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Level string `json:"level"`
	}
	if !decode(w, r, &body) {
		return
	}
	if err := s.control.SetDefaultThinking(r.Context(), body.Level); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusOK, s.control.State())
}

func (s *Server) setDefaultAgent(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Definition string `json:"definition"`
	}
	if !decode(w, r, &body) {
		return
	}
	if err := s.control.SetDefaultAgent(r.Context(), body.Definition); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusOK, s.control.State())
}

func (s *Server) setDefaultModel(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Provider string `json:"provider"`
		ModelID  string `json:"modelId"`
	}
	if !decode(w, r, &body) {
		return
	}
	if err := s.control.SetDefaultModel(r.Context(), body.Provider, body.ModelID); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusOK, s.control.State())
}

func (s *Server) conversations(w http.ResponseWriter, r *http.Request) {
	// Refreshed, not cached: the cached list is kept current by a poll that only runs
	// while a client is attached, so a script would otherwise read stale state.
	if err := s.control.RefreshConversations(r.Context()); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusOK, s.control.State().Conversations)
}

func (s *Server) createConversation(w http.ResponseWriter, r *http.Request) {
	if err := s.control.Create(r.Context()); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusOK, s.control.State())
}

func (s *Server) policy(w http.ResponseWriter, r *http.Request) {
	view, err := s.control.Policy(r.Context(), r.PathValue("id"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(view)
}

func (s *Server) renameConversation(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Title string `json:"title"`
	}
	if !decode(w, r, &body) {
		return
	}
	if err := s.control.Rename(r.Context(), r.PathValue("id"), body.Title); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusOK, s.control.State())
}

func (s *Server) hideConversation(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Hidden bool `json:"hidden"`
	}
	if !decode(w, r, &body) {
		return
	}
	if err := s.control.Hide(r.Context(), r.PathValue("id"), body.Hidden); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusOK, s.control.State())
}

func (s *Server) forkConversation(w http.ResponseWriter, r *http.Request) {
	var body struct {
		At string `json:"at"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.At == "" {
		http.Error(w, "at is required (the entry id to fork from)", http.StatusBadRequest)
		return
	}
	if err := s.control.Fork(r.Context(), r.PathValue("id"), body.At); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusOK, s.control.State())
}

func (s *Server) selectConversation(w http.ResponseWriter, r *http.Request) {
	if err := s.control.Select(r.Context(), r.PathValue("id")); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusOK, s.control.State())
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ProviderID string `json:"providerId"`
		AuthType   string `json:"authType"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.ProviderID == "" {
		http.Error(w, "providerId is required", http.StatusBadRequest)
		return
	}
	authType := body.AuthType
	switch authType {
	case "oauth", "api_key":
	case "":
		authType = "api_key"
	default:
		http.Error(w, "authType must be api_key or oauth", http.StatusBadRequest)
		return
	}
	if err := s.control.Login(r.Context(), body.ProviderID, authType); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "started"})
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	var body struct {
		ProviderID string `json:"providerId"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.ProviderID == "" {
		http.Error(w, "providerId is required", http.StatusBadRequest)
		return
	}
	if err := s.control.Logout(r.Context(), body.ProviderID); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusOK, s.control.State())
}

func (s *Server) refresh(w http.ResponseWriter, r *http.Request) {
	if err := s.control.Refresh(r.Context()); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusOK, s.control.State())
}

func (s *Server) authAnswer(w http.ResponseWriter, r *http.Request) {
	var body struct {
		AuthID    string `json:"authId"`
		PromptID  string `json:"promptId"`
		Value     string `json:"value"`
		Cancelled bool   `json:"cancelled"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.PromptID == "" {
		http.Error(w, "promptId is required", http.StatusBadRequest)
		return
	}
	if err := s.control.AnswerAuth(r.Context(), body.AuthID, body.PromptID, body.Value, body.Cancelled); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "answered"})
}

func (s *Server) authCancel(w http.ResponseWriter, r *http.Request) {
	var body struct {
		AuthID string `json:"authId"`
	}
	if !decode(w, r, &body) {
		return
	}
	if err := s.control.CancelAuth(r.Context(), body.AuthID); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "cancelled"})
}

func (s *Server) usage(w http.ResponseWriter, r *http.Request) {
	usage, err := s.control.Usage(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusOK)
	_, _ = w.Write(usage)
}

func decode(w http.ResponseWriter, r *http.Request, out any) bool {
	body, err := io.ReadAll(io.LimitReader(r.Body, 1<<20))
	if err != nil {
		http.Error(w, "cannot read body", http.StatusBadRequest)
		return false
	}
	if err := json.Unmarshal(body, out); err != nil {
		http.Error(w, "invalid JSON body", http.StatusBadRequest)
		return false
	}
	return true
}

func writeJSON(w http.ResponseWriter, status int, value any) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(status)
	_ = json.NewEncoder(w).Encode(value)
}

func writeEvent(w http.ResponseWriter, name string, value any) error {
	payload, err := json.Marshal(value)
	if err != nil {
		return err
	}
	if _, err := w.Write([]byte("event: " + name + "\ndata: ")); err != nil {
		return err
	}
	if _, err := w.Write(payload); err != nil {
		return err
	}
	_, err = w.Write([]byte("\n\n"))
	return err
}
