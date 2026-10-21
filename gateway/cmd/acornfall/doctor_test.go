package main

import (
	"context"
	"os"
	"path/filepath"
	"testing"

	"github.com/acornfall/acornfall/gateway/internal/layout"
	"github.com/acornfall/acornfall/gateway/internal/ready"
	"github.com/acornfall/acornfall/gateway/internal/sandbox"
	"github.com/acornfall/acornfall/gateway/internal/update"
)

// Doctor used to build its report manager without an engine, so it always exited with
// "sandbox: Driver is required": a diagnosis tool that could not diagnose the tier it exists
// for. This holds reportManager to naming one, and to reporting the host engine's lack of
// isolation rather than claiming a sandbox.
func TestTheDoctorReportNamesAnEngine(t *testing.T) {
	manager, err := reportManager(t.TempDir(), "")
	if err != nil {
		t.Fatalf("reportManager: %v", err)
	}
	report := manager.Report()
	if report.Engine != "microsandbox" || !report.Isolated {
		t.Errorf("the default report should be the isolated microsandbox, got %+v", report)
	}

	host, err := reportManager(t.TempDir(), "host")
	if err != nil {
		t.Fatalf("reportManager(host): %v", err)
	}
	if report := host.Report(); report.Engine != "host" || report.Isolated {
		t.Errorf("the host report should say it is not isolated, got %+v", report)
	}
}

// Nesting is answered in two halves and doctor asks both, without touching anything: an
// engine that is not installed has nothing to offer, and the host engine has no sandbox to
// nest. Both answers are the same on every machine, which is what makes them testable.
func TestDoctorNestingIsRefusedBeforeTheMachineIsChecked(t *testing.T) {
	manager, err := reportManager(t.TempDir(), "")
	if err != nil {
		t.Fatalf("reportManager: %v", err)
	}
	if support := manager.Nesting(context.Background()); support.Available || support.Reason == "" {
		t.Errorf("an engine that is not installed cannot nest, and the answer has to say why: %+v", support)
	}

	host, err := reportManager(t.TempDir(), "host")
	if err != nil {
		t.Fatalf("reportManager(host): %v", err)
	}
	if support := host.Nesting(context.Background()); support.Available || support.Reason == "" {
		t.Errorf("the host engine is not a sandbox and cannot nest: %+v", support)
	}
}

// The credentials the readiness list reports live in the mount, and doctor read the machinery
// folder: every install with a provider was told "no provider stored", including the one a
// fresh install prints. The file in the machinery folder is the old layout, which the layout
// move emptied on purpose, so it must not count either.
func TestDoctorReadsTheCredentialsFromTheMount(t *testing.T) {
	for _, c := range []struct {
		where string
		want  bool
	}{
		{"config/credentials.json", true},
		{"credentials.json", false},
	} {
		root, home := t.TempDir(), t.TempDir()
		target := filepath.Join(home, filepath.FromSlash(c.where))
		if c.want {
			target = filepath.Join(root, filepath.FromSlash(c.where))
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(target, []byte(`{"openai":{"key":"k"}}`), 0o600); err != nil {
			t.Fatal(err)
		}

		where := layout.New(root, home)
		updater := update.New(home, root, "", "")
		input := readyInput(where, updater, update.Preflight{}, sandbox.Report{}, "microsandbox")
		if input.HasCredential != c.want {
			t.Errorf("credentials at %s: doctor says stored=%v, want %v", target, input.HasCredential, c.want)
		}
		if got := requirement(t, ready.Check(input), "credentials"); got.OK != c.want {
			t.Errorf("credentials at %s: the readiness list says ok=%v, want %v", target, got.OK, c.want)
		}
	}
}

func requirement(t *testing.T, requirements []ready.Requirement, name string) ready.Requirement {
	t.Helper()
	for _, requirement := range requirements {
		if requirement.Name == name {
			return requirement
		}
	}
	t.Fatalf("the readiness list says nothing about %q", name)
	return ready.Requirement{}
}
