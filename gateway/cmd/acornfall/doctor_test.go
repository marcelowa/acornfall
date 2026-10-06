package main

import "testing"

// Doctor used to build its report manager without an engine, so it always exited with
// "sandbox: Driver is required": a diagnosis tool that could not diagnose the tier it exists
// for. This holds reportManager to naming one.
func TestTheDoctorReportNamesAnEngine(t *testing.T) {
	manager, err := reportManager(t.TempDir())
	if err != nil {
		t.Fatalf("reportManager: %v", err)
	}
	if got := manager.Report().Engine; got != "microsandbox" {
		t.Errorf("the report should name the engine, got %q", got)
	}
}
