package httpapi

import (
	"errors"
	"log"
	"net/http"
	"time"

	"github.com/acornfall/acornfall/gateway/internal/update"
)

// health is the update tier's proof of life: the switch and the rollback
// both read it. It names the running version, so a check can tell whether
// the process it reached is the new build or the old one.
func (s *Server) health(w http.ResponseWriter, _ *http.Request) {
	version := "unknown"
	if s.update != nil {
		version = s.update.Status().Current
	}
	writeJSON(w, http.StatusOK, map[string]any{"ok": true, "version": version})
}

func (s *Server) updateStatus(w http.ResponseWriter, _ *http.Request) {
	if s.update == nil {
		http.Error(w, "updates are not configured", http.StatusServiceUnavailable)
		return
	}
	status := s.update.Status()
	writeJSON(w, http.StatusOK, map[string]any{
		"current":         status.Current,
		"latest":          status.Latest,
		"notes":           status.Notes,
		"pinned":          status.Pinned,
		"channel":         status.Channel,
		"autoCheck":       s.update.Settings().AutoCheck,
		"checking":        status.Checking,
		"available":       status.Available,
		"failed":          status.Failed,
		"restartRequired": status.RestartRequired,
		"backups":         s.update.Backups(),
	})
}

func (s *Server) updateCheck(w http.ResponseWriter, r *http.Request) {
	if s.update == nil {
		http.Error(w, "updates are not configured", http.StatusServiceUnavailable)
		return
	}
	if _, err := s.update.Check(r.Context()); err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	s.updateStatus(w, r)
}

func (s *Server) updateApply(w http.ResponseWriter, r *http.Request) {
	if s.update == nil {
		http.Error(w, "updates are not configured", http.StatusServiceUnavailable)
		return
	}
	// The role check lives here now so the later admin split is a policy
	// change, not a new endpoint. Default allow: single user, same rights.
	if !s.update.IsAdmin(r) {
		http.Error(w, "contact admin: only an admin can start an update", http.StatusForbidden)
		return
	}
	var body struct {
		CleanVMs bool   `json:"cleanVMs"`
		Drain    string `json:"drain"`
	}
	if !decode(w, r, &body) {
		return
	}
	switch body.Drain {
	case "", "wait", "stop":
	default:
		http.Error(w, `drain is "wait" or "stop"`, http.StatusBadRequest)
		return
	}
	if err := s.update.Apply(r.Context(), update.ApplyOptions{CleanVMs: body.CleanVMs, Drain: body.Drain}); err != nil {
		if errors.As(err, &update.ErrRunsActive{}) || errors.As(err, &update.ErrRestartPending{}) {
			http.Error(w, err.Error(), http.StatusConflict)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	s.updateStatus(w, r)
	// One click finishes the job: the answer is on its way, then this
	// process becomes the new binary with the same args and environment.
	// The stream drops and the client reconnects on its own; an Exec
	// failure keeps the old process and the screen still says restart.
	go func() {
		time.Sleep(500 * time.Millisecond)
		if err := s.update.Restart(); err != nil {
			log.Printf("update: self-restart failed: %v", err)
		}
	}()
}

func (s *Server) updateRollback(w http.ResponseWriter, r *http.Request) {
	if s.update == nil {
		http.Error(w, "updates are not configured", http.StatusServiceUnavailable)
		return
	}
	if !s.update.IsAdmin(r) {
		http.Error(w, "contact admin: only an admin can roll back an update", http.StatusForbidden)
		return
	}
	if err := s.update.Rollback(errors.New("manual rollback from the update screen")); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	s.updateStatus(w, r)
}

func (s *Server) updateSettings(w http.ResponseWriter, r *http.Request) {
	if s.update == nil {
		http.Error(w, "updates are not configured", http.StatusServiceUnavailable)
		return
	}
	var body struct {
		Channel   *string `json:"channel"`
		AutoCheck *bool   `json:"autoCheck"`
		Pinned    *string `json:"pinned"`
	}
	if !decode(w, r, &body) {
		return
	}
	settings := s.update.Settings()
	if body.Channel != nil {
		if *body.Channel != "releases" && *body.Channel != "main" {
			http.Error(w, `channel is "releases" or "main"`, http.StatusBadRequest)
			return
		}
		settings.Channel = *body.Channel
	}
	if body.AutoCheck != nil {
		settings.AutoCheck = *body.AutoCheck
	}
	if body.Pinned != nil {
		settings.Pinned = *body.Pinned
	}
	if err := s.update.SaveSettings(settings); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	s.updateStatus(w, r)
}
