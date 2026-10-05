package control

import (
	"testing"
	"time"

	"github.com/acornfall/acornfall/gateway/internal/protocol"
)

// Idle eviction keeps an install with many workspaces cheap, which means the rules about what
// may be stopped are the feature: only a workspace nobody is watching, that is not working, and
// that nothing has asked for in a while — never the general one, which is where a client lands.
//
// Tested here rather than through the clock: waiting fifteen minutes for a sweep is not a test
// anyone runs, and the decision is a pure function of three facts.
func TestEvictionStopsOnlyIdleUnwatchedWorkspaces(t *testing.T) {
	workspaces := NewWorkspaces(WorkspacesOptions{Home: t.TempDir()})
	if err := workspaces.loadRegistry(); err != nil {
		t.Fatal(err)
	}

	// One control per situation, registered like a started workspace.
	start := func(name string) *Control {
		workspace := Workspace{Name: name, Path: t.TempDir()}
		workspaces.registry[name] = workspace
		control := New(Options{Workspace: workspace, Registry: workspaces.List})
		workspaces.controls[name] = control
		return control
	}
	start("idle")
	watched := start("watched")
	watched.mu.Lock()
	watched.subscribers[1] = make(chan protocol.Frame)
	watched.mu.Unlock()
	busy := start("busy")
	busy.mu.Lock()
	busy.conversations = []protocol.ConversationInfo{{ID: "1", Running: true}}
	busy.mu.Unlock()
	recent := start("recent")
	general := start(GeneralWorkspaceName)

	longAgo := time.Now().Add(-2 * idleEviction)
	for _, name := range []string{"idle", "watched", "busy", GeneralWorkspaceName} {
		workspaces.used[name] = longAgo
	}
	workspaces.used["recent"] = time.Now()

	stopped := make(map[string]bool)
	for _, control := range workspaces.evictCandidates() {
		stopped[control.opts.Workspace.Name] = true
	}

	if !stopped["idle"] {
		t.Error("an idle workspace nobody is watching should be stopped")
	}
	for _, name := range []string{"watched", "busy", "recent", GeneralWorkspaceName} {
		if stopped[name] {
			t.Errorf("%s should not be stopped", name)
		}
	}

	// What is stopped is also forgotten as started, or the next request would hand out a
	// control whose worker is gone — and a second worker would start over its storage.
	workspaces.mu.RLock()
	_, stillThere := workspaces.controls["idle"]
	_, keptOther := workspaces.controls["watched"]
	workspaces.mu.RUnlock()
	if stillThere {
		t.Error("a stopped workspace must be removed from the started set")
	}
	if !keptOther {
		t.Error("a watched workspace must stay started")
	}
	_ = recent
	_ = general
}

// The general workspace is where a fresh client lands, so it is never evicted even when idle.
func TestTheGeneralWorkspaceIsNeverEvicted(t *testing.T) {
	workspaces := NewWorkspaces(WorkspacesOptions{Home: t.TempDir()})
	if err := workspaces.loadRegistry(); err != nil {
		t.Fatal(err)
	}
	workspace := Workspace{Name: GeneralWorkspaceName, Path: t.TempDir(), General: true}
	workspaces.registry[GeneralWorkspaceName] = workspace
	workspaces.controls[GeneralWorkspaceName] = New(Options{Workspace: workspace, Registry: workspaces.List})
	workspaces.used[GeneralWorkspaceName] = time.Now().Add(-10 * idleEviction)

	if stopped := workspaces.evictCandidates(); len(stopped) != 0 {
		t.Errorf("the general workspace must never be stopped, stopped %d", len(stopped))
	}
}

// A workspace nobody has ever asked for is idle rather than infinitely recent: it has no worker
// to keep.
func TestAnUnusedWorkspaceIsIdle(t *testing.T) {
	workspaces := NewWorkspaces(WorkspacesOptions{Home: t.TempDir()})
	if got := workspaces.idleFor("never-heard-of-it"); got < idleEviction {
		t.Errorf("an unknown workspace should count as idle, got %s", got)
	}
	workspaces.markUsed("known")
	if got := workspaces.idleFor("known"); got > time.Second {
		t.Errorf("a workspace asked for now is not idle, got %s", got)
	}
	workspaces.forgetUsed("known")
	if got := workspaces.idleFor("known"); got < idleEviction {
		t.Errorf("forgetting should make it unknown again, got %s", got)
	}
}
