package main

import "testing"

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
