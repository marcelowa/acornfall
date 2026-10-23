package httpapi

import (
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"strings"
	"testing"

	"github.com/acornfall/acornfall/gateway/internal/control"
	"github.com/acornfall/acornfall/gateway/internal/layout"
)

// A workspace that is not started is not started by a message. Before this gate, the HTTP
// handler called Route, which booted the harness and made the request wait; a sleeping
// workspace should answer with the phase, and GET /state is the one request that starts it.
func TestAHarnessActionDoesNotStartASleepingWorkspace(t *testing.T) {
	share := t.TempDir()
	home := t.TempDir()
	workspaces := control.NewWorkspaces(control.WorkspacesOptions{
		Layout:        layout.New(share, home),
		WorkspacesDir: filepath.Join(share, "workspaces"),
	})
	if err := workspaces.Add(control.Workspace{
		Name:  "sleeping",
		Title: "sleeping",
		Path:  filepath.Join(share, "workspaces", "sleeping"),
	}); err != nil {
		t.Fatal(err)
	}
	server := New(workspaces, nil, nil)
	handler := server.Handler()

	cases := []struct {
		name string
		path string
		body string
	}{
		{"message", "/api/workspaces/sleeping/conversations/1/messages", `{"text":"hello"}`},
		{"draft", "/api/workspaces/sleeping/conversations/1/draft", `{"text":"hello"}`},
		{"commands", "/api/workspaces/sleeping/commands", `{}`},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			method := http.MethodPost
			if tc.name == "commands" {
				method = http.MethodGet
			}
			request := httptest.NewRequest(method, tc.path, strings.NewReader(tc.body))
			request.Header.Set("content-type", "application/json")
			recorder := httptest.NewRecorder()
			handler.ServeHTTP(recorder, request)
			if recorder.Code != http.StatusConflict {
				t.Fatalf("status = %d, want 409; body %q", recorder.Code, recorder.Body.String())
			}
			if !strings.Contains(recorder.Body.String(), "has not started") {
				t.Errorf("the refusal should say the workspace has not started, got %q", recorder.Body.String())
			}
		})
	}
}
