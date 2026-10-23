// Package httpapi is the transport edge. It forwards frames it does not
// interpret and never decides anything about the agent.
package httpapi

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"strings"
	"time"

	"github.com/acornfall/acornfall/gateway/internal/control"
	"github.com/acornfall/acornfall/gateway/internal/protocol"
	"github.com/acornfall/acornfall/gateway/internal/update"
)

type Server struct {
	workspaces *control.Workspaces
	static     fs.FS
	update     *update.Manager
}

func New(workspaces *control.Workspaces, static fs.FS, updates *update.Manager) *Server {
	return &Server{workspaces: workspaces, static: static, update: updates}
}

// controlFor finds the workspace a request is about. The workspace-scoped routes name it;
// the earlier paths do not, and mean the general workspace.
func (s *Server) controlFor(r *http.Request) (*control.Control, error) {
	// A handler behind ready or started already resolved the control without starting it.
	if ctl, ok := r.Context().Value(controlContextKey{}).(*control.Control); ok {
		return ctl, nil
	}
	_, ctl, err := s.workspaces.Route(r.Context(), workspaceName(r))
	if err != nil {
		return nil, err
	}
	return ctl, nil
}

// controlContextKey carries a control that the readiness wrapper already resolved.
type controlContextKey struct{}

// workspaceName is the workspace a per-workspace route names: the path, or the query for the
// older routes without one, or general.
func workspaceName(r *http.Request) string {
	name := r.PathValue("ws")
	if name == "" {
		name = r.URL.Query().Get("workspace")
	}
	if name == "" {
		name = control.GeneralWorkspaceName
	}
	return name
}

// existingControl resolves a workspace that has already started. It never starts one: only
// the state and stream requests are allowed to do that. A request for a sleeping workspace is
// a sentence, not a boot.
func (s *Server) existingControl(r *http.Request) (*control.Control, error) {
	name := workspaceName(r)
	if _, known := s.workspaces.Get(name); !known {
		return nil, fmt.Errorf("no workspace %q", name)
	}
	ctl, started := s.workspaces.Control(name)
	if !started {
		return nil, fmt.Errorf("this workspace is not ready yet: it has not started; open it first")
	}
	return ctl, nil
}

// readyControl resolves a started workspace that can take a harness action. The phase is the
// gateway's own, not a second reading of workerUp: a process that has not answered is starting.
func (s *Server) readyControl(r *http.Request) (*control.Control, error) {
	ctl, err := s.existingControl(r)
	if err != nil {
		return nil, err
	}
	if lifecycle := ctl.Lifecycle(); lifecycle.Phase != control.LifecycleReady {
		return nil, fmt.Errorf("this workspace is not ready yet: %s", lifecycle.Reason)
	}
	return ctl, nil
}

// withControl resolves a control once and hands it to the handler through the context, so the
// handler cannot start a second one or read a different phase.
func (s *Server) withControl(next http.HandlerFunc, resolve func(*http.Request) (*control.Control, error)) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ctl, err := resolve(r)
		if err != nil {
			http.Error(w, err.Error(), http.StatusConflict)
			return
		}
		next(w, r.WithContext(context.WithValue(r.Context(), controlContextKey{}, ctl)))
	}
}

// ready is every route that needs the harness: a workspace that is not ready gets the phase's
// sentence instead of a write into a process that is not there.
func (s *Server) ready(next http.HandlerFunc) http.HandlerFunc {
	return s.withControl(next, s.readyControl)
}

// started is the draft route: it may use a control that is still starting, but it must never
// start one. A draft is words, not a harness action.
func (s *Server) started(next http.HandlerFunc) http.HandlerFunc {
	return s.withControl(next, s.existingControl)
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()

	// A conversation is addressed under the workspace it belongs to, because ids are only
	// unique inside a workspace's storage. The earlier paths without a workspace mean the
	// general one, so existing links and scripts keep working.
	for _, base := range []string{"/api/workspaces/{ws}", "/api"} {
		mux.HandleFunc("GET "+base+"/state", s.state)
		mux.HandleFunc("GET "+base+"/stream", s.stream)
		mux.HandleFunc("GET "+base+"/conversations", s.ready(s.conversations))
		mux.HandleFunc("POST "+base+"/conversations", s.ready(s.createConversation))
		mux.HandleFunc("POST "+base+"/conversations/{id}/select", s.ready(s.selectConversation))
		mux.HandleFunc("POST "+base+"/conversations/{id}/rename", s.ready(s.renameConversation))
		mux.HandleFunc("POST "+base+"/conversations/{id}/hide", s.ready(s.hideConversation))
		mux.HandleFunc("POST "+base+"/conversations/{id}/fork", s.ready(s.forkConversation))
		mux.HandleFunc("POST "+base+"/conversations/{id}/compact", s.ready(s.compactConversation))
		mux.HandleFunc("POST "+base+"/conversations/{id}/compact-preview", s.ready(s.compactPreview))
		mux.HandleFunc("POST "+base+"/conversations/{id}/messages", s.ready(s.messages))
		mux.HandleFunc("POST "+base+"/conversations/{id}/draft", s.started(s.draft))
		mux.HandleFunc("POST "+base+"/attachments", s.ready(s.attachments))
		mux.HandleFunc("POST "+base+"/conversations/{id}/abort", s.ready(s.abort))
		mux.HandleFunc("POST "+base+"/conversations/{id}/agent", s.ready(s.agent))
		mux.HandleFunc("GET "+base+"/conversations/{id}/policy", s.ready(s.policy))
		mux.HandleFunc("GET "+base+"/conversations/{id}/messages", s.ready(s.messagesDoc))
		mux.HandleFunc("GET "+base+"/agents", s.ready(s.agents))
		mux.HandleFunc("GET "+base+"/commands", s.ready(s.commands))
		mux.HandleFunc("POST "+base+"/agents/reload", s.ready(s.reload))
		mux.HandleFunc("GET "+base+"/usage", s.ready(s.usage))
		mux.HandleFunc("POST "+base+"/providers/login", s.ready(s.login))
		mux.HandleFunc("POST "+base+"/providers/logout", s.ready(s.logout))
		mux.HandleFunc("POST "+base+"/providers/refresh", s.ready(s.refresh))
		mux.HandleFunc("POST "+base+"/auth/answer", s.ready(s.authAnswer))
		mux.HandleFunc("POST "+base+"/auth/cancel", s.ready(s.authCancel))
		mux.HandleFunc("POST "+base+"/default-model", s.ready(s.setDefaultModel))
		mux.HandleFunc("POST "+base+"/default-thinking", s.ready(s.setDefaultThinking))
		mux.HandleFunc("POST "+base+"/default-agent", s.ready(s.setDefaultAgent))
	}

	// Install-wide defaults: no workspace in the path, because the point of them is that
	// they are not any one workspace's.
	mux.HandleFunc("POST /api/defaults/model", s.setInstallDefaultModel)
	mux.HandleFunc("POST /api/defaults/thinking", s.setInstallDefaultThinking)
	mux.HandleFunc("POST /api/defaults/agent", s.setInstallDefaultAgent)

	mux.HandleFunc("GET /healthz", s.health)

	mux.HandleFunc("GET /api/update/status", s.updateStatus)
	mux.HandleFunc("GET /api/update/releases", s.updateReleases)
	mux.HandleFunc("GET /api/update/releases/{tag}", s.updateRelease)
	mux.HandleFunc("GET /api/update/notes", s.updateNotes)
	mux.HandleFunc("POST /api/update/check", s.updateCheck)
	mux.HandleFunc("POST /api/update/apply", s.updateApply)
	mux.HandleFunc("POST /api/update/restart", s.updateRestart)
	mux.HandleFunc("POST /api/update/rollback", s.updateRollback)
	mux.HandleFunc("POST /api/update/settings", s.updateSettings)

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
	mux.HandleFunc("GET /update", s.page)
	mux.HandleFunc("GET /update/{tag}", s.page)
	mux.HandleFunc("GET /settings", s.page)
	mux.HandleFunc("GET /settings/", s.page)
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
		// DisableVMNesting, when true, keeps this workspace's sandbox from nesting;
		// absent or false follows the install's --disable-vm-nesting.
		// Privileged, when true, runs this workspace's sandbox as root in the machine instead of
		// inside a user namespace (ADR 0021's open question); absent is the default, which is
		// unprivileged.
		Privileged       *bool `json:"privileged"`
		DisableVMNesting *bool `json:"disable_vm_nesting"`
		Trusted          *bool `json:"trusted"`
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

	if body.Privileged != nil {
		workspace.Privileged = *body.Privileged
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
		// DisableVMNesting, when present, keeps this workspace's sandbox from nesting;
		// absent leaves the workspace's own setting alone.
		DisableVMNesting *bool `json:"disable_vm_nesting"`
		// Privileged, when present, changes whether this workspace's sandbox runs as root in the
		// machine; absent leaves the workspace's own setting alone.
		Privileged *bool `json:"privileged"`
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

	if body.Privileged != nil {
		existing.Privileged = *body.Privileged
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
	id, frames, stale, initial, err := ctl.Subscribe(r.Context(), conversationID)
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
		// The state moved, and the client's copy is stale. It is answered with the state
		// itself, built now rather than when the signal was raised: the signal can wait,
		// the state cannot be old.
		case <-stale:
			if err := writeEvent(w, "state", ctl.StateFor(conversationID)); err != nil {
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
		Text        string            `json:"text"`
		WhenBusy    protocol.WhenBusy `json:"whenBusy"`
		Attachments []string          `json:"attachments"`
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
	if err := ctl.Prompt(r.Context(), r.PathValue("id"), strings.TrimSpace(body.Text), when, body.Attachments); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "accepted"})
}

// draft is the composer's own write: the unsent message of one conversation, saved so the
// same words wait there on every machine and on the next reload. Empty words and no files
// clear it; the answer is what was stored, stamp included, so the client can tell its own
// echo from another machine's write.
func (s *Server) draft(w http.ResponseWriter, r *http.Request) {
	ctl, err := s.controlFor(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	var body struct {
		Text        string                    `json:"text"`
		Attachments []control.DraftAttachment `json:"attachments"`
	}
	if !decode(w, r, &body) {
		return
	}
	stored, err := ctl.SetDraft(r.PathValue("id"), body.Text, body.Attachments)
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusOK, stored)
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

func (s *Server) compactConversation(w http.ResponseWriter, r *http.Request) {
	ctl, err := s.controlFor(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	if err := ctl.Compact(r.Context(), r.PathValue("id")); err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusOK, ctl.State())
}

func (s *Server) compactPreview(w http.ResponseWriter, r *http.Request) {
	ctl, err := s.controlFor(r)
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	preview, err := ctl.CompactPreview(r.Context(), r.PathValue("id"))
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusOK, preview)
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
	authID, err := ctl.Login(r.Context(), body.ProviderID, authType)
	if err != nil {
		http.Error(w, err.Error(), http.StatusConflict)
		return
	}
	writeJSON(w, http.StatusAccepted, map[string]string{"status": "started", "authId": authID})
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
