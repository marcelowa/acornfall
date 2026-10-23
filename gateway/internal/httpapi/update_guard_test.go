package httpapi

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// While an update runs, a write is refused by the gateway itself. The status is still
// readable: the console needs it to say what is happening.
func TestAnUpdateBlocksWritesButNotStatus(t *testing.T) {
	server, manager := updateServer(t)
	manager.WithLauncherOwner()
	if err := manager.SetCurrentVersion("v0.8.0"); err != nil {
		t.Fatal(err)
	}
	if err := manager.AskHost("v0.9.0"); err != nil {
		t.Fatal(err)
	}
	if status := manager.Status(); !status.Blocking || status.Phase != "requested" {
		t.Fatalf("the fixture is not blocking: %+v", status)
	}

	blocked := []struct {
		name string
		path string
		body string
	}{
		{"message", "/api/workspaces/general/conversations/1/messages", `{"text":"hello"}`},
		{"workspace create", "/api/workspaces", `{"name":"new"}`},
		{"install default", "/api/defaults/model", `{"provider":"p","modelId":"m"}`},
		{"a second update", "/api/update/apply", `{"tag":"v0.9.0"}`},
	}
	for _, tc := range blocked {
		t.Run(tc.name, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodPost, tc.path, strings.NewReader(tc.body))
			request.Header.Set("content-type", "application/json")
			recorder := httptest.NewRecorder()
			server.Handler().ServeHTTP(recorder, request)
			if recorder.Code != http.StatusConflict {
				t.Fatalf("status = %d, want 409; body %q", recorder.Code, recorder.Body.String())
			}
			if !strings.Contains(recorder.Body.String(), "update") {
				t.Errorf("the refusal should name the update, got %q", recorder.Body.String())
			}
		})
	}

	request := httptest.NewRequest(http.MethodGet, "/api/update/status", nil)
	recorder := httptest.NewRecorder()
	server.Handler().ServeHTTP(recorder, request)
	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want 200", recorder.Code)
	}
	var body map[string]any
	if err := json.Unmarshal(recorder.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["blocking"] != true || body["phase"] != "requested" || body["target"] != "v0.9.0" {
		t.Errorf("status does not carry the update phase: %v", body)
	}
}
