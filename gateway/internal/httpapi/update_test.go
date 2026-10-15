package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/acornfall/acornfall/gateway/internal/update"
)

func updateServer(t *testing.T) (*Server, *update.Manager) {
	t.Helper()
	home := t.TempDir()
	bin := filepath.Join(t.TempDir(), "acornfall")
	if err := os.WriteFile(bin, []byte("old"), 0o755); err != nil {
		t.Fatal(err)
	}
	manager := update.New(home, bin, t.TempDir())
	if err := manager.SetCurrentVersion("v0.8.0"); err != nil {
		t.Fatal(err)
	}
	return New(nil, nil, manager), manager
}

func TestUpdateStatusNamesCurrentAndLatest(t *testing.T) {
	server, _ := updateServer(t)
	// No release checked yet: the status still names the current build and
	// carries every field the update screen reads.
	request := httptest.NewRequest(http.MethodGet, "/api/update/status", nil)
	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d", recorder.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["current"] != "v0.8.0" {
		t.Fatalf("current = %v", body["current"])
	}
	for _, field := range []string{"available", "latest", "notes", "pinned", "checking", "backups"} {
		if _, ok := body[field]; !ok {
			t.Fatalf("status must carry %q", field)
		}
	}
}

func TestUpdateCheckNeedsUpstream(t *testing.T) {
	server, _ := updateServer(t)
	request := httptest.NewRequest(http.MethodPost, "/api/update/check", strings.NewReader("{}"))
	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, request)
	// No network in tests worth trusting: the point is the endpoint exists
	// and answers JSON either way, never a panic or a redirect.
	if recorder.Code != http.StatusOK && recorder.Code != http.StatusBadGateway {
		t.Fatalf("check = %d", recorder.Code)
	}
}

func TestUpdateApplyRefusesNonAdmin(t *testing.T) {
	server, manager := updateServer(t)
	manager.IsAdmin = func(*http.Request) bool { return false }
	request := httptest.NewRequest(http.MethodPost, "/api/update/apply",
		strings.NewReader(`{"drain":"stop"}`))
	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusForbidden {
		t.Fatalf("apply as non-admin = %d, want 403", recorder.Code)
	}
	if !strings.Contains(recorder.Body.String(), "contact admin") {
		t.Fatalf("non-admin refusal must say who can: %q", recorder.Body.String())
	}
}

func TestUpdateApplyRefusesBadDrain(t *testing.T) {
	server, _ := updateServer(t)
	request := httptest.NewRequest(http.MethodPost, "/api/update/apply",
		strings.NewReader(`{"drain":"eventually"}`))
	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("bad drain = %d, want 400", recorder.Code)
	}
}

func TestUpdateApplyRefusesWhileRunsActive(t *testing.T) {
	server, manager := updateServer(t)
	manager.RunsActive = func() bool { return true }
	// The runs gate runs before any fetch: no release is seeded and no
	// network is needed for this refusal.
	request := httptest.NewRequest(http.MethodPost, "/api/update/apply",
		strings.NewReader(`{"drain":"wait"}`))
	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusConflict {
		t.Fatalf("apply during runs = %d, want 409", recorder.Code)
	}
}

func TestUpdateReleasesRejectsBadLimit(t *testing.T) {
	server, _ := updateServer(t)
	// Validation runs before any fetch, so this needs no network.
	request := httptest.NewRequest(http.MethodGet, "/api/update/releases?limit=none", nil)
	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("bad limit = %d, want 400", recorder.Code)
	}
}

func TestUpdateReleasesAnswersOrNamesUpstream(t *testing.T) {
	server, _ := updateServer(t)
	request := httptest.NewRequest(http.MethodGet, "/api/update/releases", nil)
	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, request)
	// No release source worth trusting in a unit test: the point is the
	// endpoint exists and answers JSON either way, never a panic or a page.
	if recorder.Code != http.StatusOK && recorder.Code != http.StatusBadGateway {
		t.Fatalf("releases = %d", recorder.Code)
	}
	if recorder.Code != http.StatusOK {
		return
	}
	var body struct {
		Releases []any `json:"releases"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body.Releases == nil {
		t.Fatal("releases must be a list, empty rather than null")
	}
}

func TestUpdateApplyNamesAMissingPickedTag(t *testing.T) {
	server, _ := updateServer(t)
	// A tag the repo does not have: the answer is 404 when the source
	// answers, 500 only when it cannot be reached at all.
	request := httptest.NewRequest(http.MethodPost, "/api/update/apply",
		strings.NewReader(`{"tag":"vnope-v0.0.0"}`))
	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusNotFound && recorder.Code != http.StatusInternalServerError {
		t.Fatalf("missing picked tag = %d, want 404 (or 500 offline)", recorder.Code)
	}
}

func TestUpdateSettingsValidatesChannel(t *testing.T) {
	server, _ := updateServer(t)
	request := httptest.NewRequest(http.MethodPost, "/api/update/settings",
		strings.NewReader(`{"channel":"carrier-pigeon"}`))
	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("bad channel = %d, want 400", recorder.Code)
	}
	// The tree-build channel is designed, not built: asking for it by
	// name refuses rather than silently keeping releases.
	second := httptest.NewRequest(http.MethodPost, "/api/update/settings",
		strings.NewReader(`{"channel":"main"}`))
	secondRecorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(secondRecorder, second)
	if secondRecorder.Code != http.StatusBadRequest {
		t.Fatalf("main channel = %d, want 400", secondRecorder.Code)
	}
}

func TestHealthNamesVersion(t *testing.T) {
	server, _ := updateServer(t)
	request := httptest.NewRequest(http.MethodGet, "/healthz", nil)
	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("healthz = %d", recorder.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["ok"] != true || body["version"] != "v0.8.0" {
		t.Fatalf("bad health body %v", body)
	}
}
