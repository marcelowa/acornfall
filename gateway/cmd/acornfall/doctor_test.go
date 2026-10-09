package main

import (
	"context"
	"testing"
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
