// Package httpapi is the transport edge. It forwards frames it does not
// interpret and never decides anything about the agent.
package httpapi

import (
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"strings"
	"time"

	"github.com/acornfall/acornfall/gateway/internal/control"
	"github.com/acornfall/acornfall/gateway/internal/protocol"
)

type Server struct {
	workspaces *control.Workspaces
	static     fs.FS
}

func New(workspaces *control.Workspaces, static fs.FS) *Server {
	return &Server{workspaces: workspaces, static: static}
}

// controlFor finds the workspace a request is about. The workspace-scoped routes name it;
// the earlier paths do not, and mean the general workspace.
func (s *Server) controlFor(r *http.Request) (*control.Control, error) {
	name := r.PathValue("ws")
	if name == "" {
		name = r.URL.Query().Get("workspace")
	}
	_, ctl, err := s.workspaces.Route(r.Context(), name)
	if err != nil {
		return nil, err
	}
	return ctl, nil
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	// A conversation is addressed under the workspace it belongs to, because ids are only
	// unique inside a workspace's storage. The earlier paths without a workspace mean the
	// general one, so existing links and scripts keep working.
	for _, base := range []string{"/api/workspaces/{ws}", "/api"} {
		mux.HandleFunc("GET "+base+"/state", s.state)
		mux.HandleFunc("GET "+base+"/stream", s.stream)
		mux.HandleFunc("GET "+base+"/conversations", s.conversations)
		mux.HandleFunc("POST "+base+"/conversations", s.createConversation)
		mux.HandleFunc("POST "+base+"/conversations/{id}/select", s.selectConversation)
		mux.HandleFunc("POST "+base+"/conversations/{id}/rename", s.renameConversation)
		mux.HandleFunc("POST "+base+"/conversations/{id}/hide", s.hideConversation)
		mux.HandleFunc("POST "+base+"/conversations/{id}/fork", s.forkConversation)
		mux.HandleFunc("POST "+base+"/conversations/{id}/messages", s.messages)
		mux.HandleFunc("POST "+base+"/conversations/{id}/abort", s.abort)
		mux.HandleFunc("POST "+base+"/conversations/{id}/agent", s.agent)
		mux.HandleFunc("GET "+base+"/conversations/{id}/policy", s.policy)
		mux.HandleFunc("GET "+base+"/conversations/{id}/messages", s.messagesDoc)
		mux.HandleFunc("GET "+base+"/agents", s.agents)
		mux.HandleFunc("GET "+base+"/commands", s.commands)
		mux.HandleFunc("POST "+base+"/agents/reload", s.reload)
		mux.HandleFunc("GET "+base+"/usage", s.usage)
		mux.HandleFunc("POST "+base+"/providers/login", s.login)
		mux.HandleFunc("POST "+base+"/providers/logout", s.logout)
		mux.HandleFunc("POST "+base+"/providers/refresh", s.refresh)
		mux.HandleFunc("POST "+base+"/auth/answer", s.authAnswer)
		mux.HandleFunc("POST "+base+"/auth/cancel", s.authCancel)
		mux.HandleFunc("POST "+base+"/default-model", s.setDefaultModel)
		mux.HandleFunc("POST "+base+"/default-thinking", s.setDefaultThinking)
		mux.HandleFunc("POST "+base+"/default-agent", s.setDefaultAgent)
	}

	// Install-wide defaults: no workspace in the path, because the point of them is that
	// they are not any one workspace's.
	mux.HandleFunc("POST /api/defaults/model", s.setInstallDefaultModel)
	mux.HandleFunc("POST /api/defaults/thinking", s.setInstallDefaultThinking)
	mux.HandleFunc("POST /api/defaults/agent", s.setInstallDefaultAgent)

	mux.HandleFunc("GET /api/workspaces", s.workspaceList)
	mux.HandleFunc("POST /api/workspaces", s.workspaceCreate)
	mux.HandleFunc("POST /api/workspaces/{ws}/update", s.workspaceUpdate)
	mux.HandleFunc("POST /api/workspaces/{ws}/remove", s.workspaceRemove)

	// /c/<workspace>/<conversation> is a conversation, /w/<workspace> is a workspace with
	// whichever conversation it lands on, and the interface's own screens are routes too so a
	// reload and a shared link land where someone was.
	mux.HandleFunc("GET /c/{ws}/{id}", s.page)
	mux.HandleFunc("GET /c/{id}", s.page)
	mux.HandleFunc("GET /w/{ws}", s.page)
	mux.HandleFunc("GET /settings", s.page)
	mux.HandleFunc("GET /workspaces", s.page)
	mux.Handle("GET /", noCache(http.FileServerFS(s.static)))
	return mux
}

func (s *Server) workspaceList(w http.ResponseWriter, r *http.Request) {
	// The folder is reported with the list, so the interface can say where a new workspace
	// will be created instead of asking for a path it should not be given.
	writeJSON(w, http.StatusOK, s.listing())
}

// listing is the one shape every workspace endpoint answers with, so a caller never has to
// know which operation produced it.
func (s *Server) listing() map[string]any {
	return map[string]any{
		"workspacesDir": s.workspaces.Dir(),
		"workspaces":    control.Views(s.workspaces.List()),
	}
}

// workspaceCreate makes a workspace inside the workspaces folder. It takes a name, not a
// path: the interface is scoped to one directory on purpose, and a folder anywhere else on
// the machine is an operator's decision rather than a form field.
func (s *Server) workspaceCreate(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Name    string  `json:"name"`
		Title   string  `json:"title"`
		Path    *string `json:"path"`
		Image   *string `json:"image"`
		Network *string `json:"network"`
		// AllowVMNesting, when present, decides whether this workspace's sandbox may nest;
		// absent follows the install's --allow-vm-nesting.
		AllowVMNesting *bool `json:"allow_vm_nesting"`
		Trusted        *bool `json:"trusted"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.Trusted != nil {
		// Refused rather than ignored, for the same reason as a path: a workspace used to carry
		// a trust flag that decided whether its own resources were read, and it does not any
		// more. A caller that asks for the old behaviour should be told, not humoured.
		http.Error(w, "every workspace's own agents, skills, commands, and rules are read; there is no trust flag", http.StatusBadRequest)
		return
	}
	if body.Network != nil && !control.ValidNetwork(*body.Network) {
		http.Error(w, `network is "on" or "off"`, http.StatusBadRequest)
		return
	}
	if body.Path != nil {
		// Refused rather than ignored: accepting and dropping it would be a field that does
		// nothing, and pointing at a folder elsewhere is the operator's command.
		http.Error(w, "workspaces are created inside "+s.workspaces.Dir()+"; use `acornfall workspace add` for a folder elsewhere", http.StatusBadRequest)
		return
	}
	workspace, err := s.workspaces.Create(body.Name)
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	workspace.Title = firstNonEmpty(body.Title, workspace.Title)
	if body.Image != nil {
		workspace.Image = *body.Image
	}
	if body.Network != nil {
		workspace.Network = *body.Network
	}
	if body.AllowVMNesting != nil {
		workspace.AllowVMNesting = body.AllowVMNesting
	}
	if err := s.workspaces.Update(workspace); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusOK, s.listing())
}

func (s *Server) workspaceUpdate(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("ws")
	existing, ok := s.workspaces.Get(name)
	if !ok {
		http.Error(w, fmt.Sprintf("no workspace %q", name), http.StatusNotFound)
		return
	}
	// Pointers, so a partial update cannot silently clear a field it did not mention. No
	// path: moving a workspace to a folder of the interface's choosing is exactly what the
	// workspaces folder exists to prevent.
	var body struct {
		Title   *string `json:"title"`
		Image   *string `json:"image"`
		Network *string `json:"network"`
		Trusted *bool   `json:"trusted"`
		// AllowVMNesting, when present, decides whether this workspace's sandbox may nest;
		// absent leaves the workspace's own setting alone.
		AllowVMNesting *bool `json:"allow_vm_nesting"`
	}
	if !decode(w, r, &body) {
		return
	}
	if body.Trusted != nil {
		http.Error(w, "every workspace's own agents, skills, commands, and rules are read; there is no trust flag", http.StatusBadRequest)
		return
	}
	if body.Network != nil && !control.ValidNetwork(*body.Network) {
		// Refused rather than ignored: a caller asking for a network setting we do not have
		// should be told, not humoured.
		http.Error(w, `network is "on" or "off"`, http.StatusBadRequest)
		return
	}
	if body.Title != nil {
		existing.Title = *body.Title
	}
	if body.Image != nil {
		existing.Image = *body.Image
	}
	if body.Network != nil {
		existing.Network = *body.Network
	}
	if body.AllowVMNesting != nil {
		existing.AllowVMNesting = body.AllowVMNesting
	}
	if err := s.workspaces.Update(existing); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusOK, s.listing())
}

func (s *Server) workspaceRemove(w http.ResponseWriter, r *http.Request) {
	if err := s.workspaces.Remove(r.Context(), r.PathValue("ws")); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusOK, s.listing())
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if value != "" {
			return value
		}
	}
	return ""
}

// noCache keeps a reload honest while the client has no build step and no
// content hashes: a stale bundle is indistinguishable from a broken one.
func noCache(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Cache-Control", "no-cache")
		next.ServeHTTP(w, r)
	})
}

func (s *Server) state(w http.ResponseWriter, r *http.Request) {
	ctl, err := s.controlFor(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusOK, ctl.StateFor(r.URL.Query().Get("conversation")))
}

// stream is SSE. Commands are POSTs; this direction is the only streaming one,
// so a reconnect is built in and no socket library is needed.
func (s *Server) stream(w http.ResponseWriter, r *http.Request) {
	ctl, err := s.controlFor(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
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

	// How long the browser should wait before reconnecting.
	if _, err := w.Write([]byte("retry: 3000\n\n")); err != nil {
		return
	}

	// Each client names the conversation it wants, so two tabs can watch two
	// conversations without agreeing on an active one.
	conversationID := r.URL.Query().Get("conversation")
	id, frames, initial, err := ctl.Subscribe(r.Context(), conversationID)
	if err != nil {
		// The stream is already open, so a status line here would be a second header that no
		// client reads. Say it on the stream and close: the client reconnects, which is what
		// an EventSource does with a closed connection, and it works once the reason is gone.
		_ = writeEvent(w, "state", map[string]string{"error": err.Error()})
		flusher.Flush()
		return
	}
	defer ctl.Unsubscribe(id)

	if err := writeEvent(w, "state", ctl.StateFor(conversationID)); err != nil {
		return
	}
	if initial != nil {
		if err := writeEvent(w, "frame", *initial); err != nil {
			return
		}
	}
	flusher.Flush()

	// A named event, not a comment: an SSE comment keeps the socket alive but fires no
	// event, so a client could not tell a healthy idle stream from a dead one. This is
	// what the interface counts as proof of life.
	ticker := time.NewTicker(3 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-r.Context().Done():
			return
		case <-ticker.C:
			if err := writeEvent(w, "ping", map[string]int64{"at": time.Now().UnixMilli()}); err != nil {
				return
			}
			flusher.Flush()
		case frame := <-frames:
			if err := writeEvent(w, "frame", frame); err != nil {
				return
			}
			flusher.Flush()
		}
	}
}

func (s *Server) commands(w http.ResponseWriter, r *http.Request) {
	ctl, err := s.controlFor(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	list, err := ctl.Commands(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusOK, json.RawMessage(list))
}

func (s *Server) agents(w http.ResponseWriter, r *http.Request) {
	ctl, err := s.controlFor(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	data, err := ctl.Agents(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusOK, data)
}

func (s *Server) reload(w http.ResponseWriter, r *http.Request) {
	ctl, err := s.controlFor(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	if err := ctl.Reload(r.Context()); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusOK, ctl.State())
}

func (s *Server) messages(w http.ResponseWriter, r *http.Request) {
	ctl, err := s.controlFor(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
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
	if err := ctl.Prompt(r.Context(), r.PathValue("id"), strings.TrimSpace(body.Text), when); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "accepted"})
}

func (s *Server) abort(w http.ResponseWriter, r *http.Request) {
	ctl, err := s.controlFor(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	if err := ctl.Abort(r.Context(), r.PathValue("id")); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "aborted"})
}

func (s *Server) agent(w http.ResponseWriter, r *http.Request) {
	ctl, err := s.controlFor(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
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
	if err := ctl.SetAgent(r.Context(), r.PathValue("id"), control.AgentChange{
		Provider:      body.Provider,
		ModelID:       body.ModelID,
		ThinkingLevel: body.ThinkingLevel,
		Definition:    body.Definition,
	}); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusOK, ctl.State())
}

func (s *Server) setDefaultThinking(w http.ResponseWriter, r *http.Request) {
	ctl, err := s.controlFor(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	var body struct {
		Level string `json:"level"`
	}
	if !decode(w, r, &body) {
		return
	}
	if err := ctl.SetDefaultThinking(r.Context(), body.Level); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusOK, ctl.State())
}

func (s *Server) setDefaultAgent(w http.ResponseWriter, r *http.Request) {
	ctl, err := s.controlFor(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	var body struct {
		Definition string `json:"definition"`
	}
	if !decode(w, r, &body) {
		return
	}
	if err := ctl.SetDefaultAgent(r.Context(), body.Definition); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusOK, ctl.State())
}

func (s *Server) setInstallDefaultModel(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Provider string `json:"provider"`
		ModelID  string `json:"modelId"`
	}
	if !decode(w, r, &body) {
		return
	}
	if err := s.workspaces.SetInstallModel(r.Context(), body.Provider, body.ModelID); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusOK, s.listing())
}

func (s *Server) setInstallDefaultThinking(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Level string `json:"level"`
	}
	if !decode(w, r, &body) {
		return
	}
	if err := s.workspaces.SetInstallThinking(r.Context(), body.Level); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusOK, s.listing())
}

func (s *Server) setInstallDefaultAgent(w http.ResponseWriter, r *http.Request) {
	var body struct {
		Definition string `json:"definition"`
	}
	if !decode(w, r, &body) {
		return
	}
	if err := s.workspaces.SetInstallAgent(r.Context(), body.Definition); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusOK, s.listing())
}

func (s *Server) setDefaultModel(w http.ResponseWriter, r *http.Request) {
	ctl, err := s.controlFor(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	var body struct {
		Provider string `json:"provider"`
		ModelID  string `json:"modelId"`
	}
	if !decode(w, r, &body) {
		return
	}
	if err := ctl.SetDefaultModel(r.Context(), body.Provider, body.ModelID); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusOK, ctl.State())
}

// page serves the client for a conversation route, so a reload and a shared link both
// land on the same conversation.
func (s *Server) page(w http.ResponseWriter, _ *http.Request) {
	file, err := s.static.Open("index.html")
	if err != nil {
		http.Error(w, "client not found", http.StatusInternalServerError)
		return
	}
	defer func() { _ = file.Close() }()
	w.Header().Set("Content-Type", "text/html; charset=utf-8")
	w.Header().Set("Cache-Control", "no-cache")
	_, _ = io.Copy(w, file)
}

func (s *Server) conversations(w http.ResponseWriter, r *http.Request) {
	ctl, err := s.controlFor(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	// Refreshed, not cached: the cached list is kept current by a poll that only runs
	// while a client is attached, so a script would otherwise read stale state.
	if err := ctl.RefreshConversations(r.Context()); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusOK, ctl.State().Conversations)
}

func (s *Server) createConversation(w http.ResponseWriter, r *http.Request) {
	ctl, err := s.controlFor(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	if err := ctl.Create(r.Context()); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusOK, ctl.State())
}

func (s *Server) policy(w http.ResponseWriter, r *http.Request) {
	ctl, err := s.controlFor(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	view, err := ctl.Policy(r.Context(), r.PathValue("id"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusOK, json.RawMessage(view))
}

// messagesDoc exposes which entries were sent by another conversation, for debugging
// attribution without opening a browser.
func (s *Server) messagesDoc(w http.ResponseWriter, r *http.Request) {
	ctl, err := s.controlFor(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	view, err := ctl.WorkerCall(r.Context(), "messages", r.PathValue("id"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusOK, json.RawMessage(view))
}

func (s *Server) renameConversation(w http.ResponseWriter, r *http.Request) {
	ctl, err := s.controlFor(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	var body struct {
		Title string `json:"title"`
	}
	if !decode(w, r, &body) {
		return
	}
	if err := ctl.Rename(r.Context(), r.PathValue("id"), body.Title); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusOK, ctl.State())
}

func (s *Server) hideConversation(w http.ResponseWriter, r *http.Request) {
	ctl, err := s.controlFor(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	var body struct {
		Hidden bool `json:"hidden"`
	}
	if !decode(w, r, &body) {
		return
	}
	if err := ctl.Hide(r.Context(), r.PathValue("id"), body.Hidden); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusOK, ctl.State())
}

func (s *Server) forkConversation(w http.ResponseWriter, r *http.Request) {
	ctl, err := s.controlFor(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
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
	if err := ctl.Fork(r.Context(), r.PathValue("id"), body.At); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusOK, ctl.State())
}

func (s *Server) selectConversation(w http.ResponseWriter, r *http.Request) {
	ctl, err := s.controlFor(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	if err := ctl.Select(r.Context(), r.PathValue("id")); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusOK, ctl.State())
}

func (s *Server) login(w http.ResponseWriter, r *http.Request) {
	ctl, err := s.controlFor(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
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
	if err := ctl.Login(r.Context(), body.ProviderID, authType); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "started"})
}

func (s *Server) logout(w http.ResponseWriter, r *http.Request) {
	ctl, err := s.controlFor(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
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
	if err := ctl.Logout(r.Context(), body.ProviderID); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusOK, ctl.State())
}

func (s *Server) refresh(w http.ResponseWriter, r *http.Request) {
	ctl, err := s.controlFor(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	if err := ctl.Refresh(r.Context()); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusOK, ctl.State())
}

func (s *Server) authAnswer(w http.ResponseWriter, r *http.Request) {
	ctl, err := s.controlFor(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
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
	if err := ctl.AnswerAuth(r.Context(), body.AuthID, body.PromptID, body.Value, body.Cancelled); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "answered"})
}

func (s *Server) authCancel(w http.ResponseWriter, r *http.Request) {
	ctl, err := s.controlFor(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	var body struct {
		AuthID string `json:"authId"`
	}
	if !decode(w, r, &body) {
		return
	}
	if err := ctl.CancelAuth(r.Context(), body.AuthID); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusOK, map[string]string{"status": "cancelled"})
}

func (s *Server) usage(w http.ResponseWriter, r *http.Request) {
	ctl, err := s.controlFor(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	usage, err := ctl.Usage(r.Context())
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusOK, json.RawMessage(usage))
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
