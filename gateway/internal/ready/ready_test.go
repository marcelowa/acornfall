package ready

import (
	"os"
	"path/filepath"
	"testing"
)

func testInput(home string) Input {
	return Input{
		Home:            home,
		Current:         "v0.9.0",
		Worker:          "v0.9.0",
		BunPath:         filepath.Join(home, "tools", "bun-1.4.2", "bun"),
		BunOK:           true,
		EngineName:      "microsandbox",
		EngineVersion:   "0.7.6",
		EngineInstalled: true,
		EngineIsolated:  true,
		Latest:          "v0.9.0",
		HasCredential:   true,
	}
}

func byName(requirements []Requirement, name string) Requirement {
	for _, requirement := range requirements {
		if requirement.Name == name {
			return requirement
		}
	}
	return Requirement{}
}

func TestSatisfiedInstallIsQuiet(t *testing.T) {
	home := t.TempDir()
	requirements := Check(testInput(home))
	if !Satisfied(requirements) {
		for _, requirement := range requirements {
			if !requirement.OK {
				t.Errorf("%s: %s (fix: %s)", requirement.Name, requirement.Detail, requirement.Fix)
			}
		}
	}
}

func TestMissingPiecesNameFixes(t *testing.T) {
	home := t.TempDir()
	input := testInput(home)
	input.Worker = ""
	input.BunOK = false
	input.HasCredential = false
	input.Latest = ""
	input.ReleasesNote = "unreachable: refused"
	requirements := Check(input)
	if Satisfied(requirements) {
		t.Fatal("missing pieces must not satisfy")
	}
	for _, name := range []string{"worker", "bun", "credentials", "releases"} {
		requirement := byName(requirements, name)
		if requirement.OK {
			t.Errorf("%s should fail", name)
		}
		if requirement.Fix == "" {
			t.Errorf("%s must name a fix", name)
		}
	}
}

func TestEngineRefusalIsStated(t *testing.T) {
	home := t.TempDir()
	input := testInput(home)
	input.EngineInstalled = false
	input.EngineProblem = ""
	input.EngineDisabled = "ACORNFALL_NO_SANDBOX is set"
	requirement := byName(Check(input), "engine")
	if !requirement.OK {
		t.Fatal("a stated refusal is an answer, not a failure")
	}
}

func TestEngineProblemFails(t *testing.T) {
	home := t.TempDir()
	input := testInput(home)
	input.EngineInstalled = false
	input.EngineProblem = "no hypervisor"
	if requirement := byName(Check(input), "engine"); requirement.OK {
		t.Fatal("an engine problem must fail")
	}
}

func TestCredentialsReadTheFile(t *testing.T) {
	home := t.TempDir()
	if HasCredential(home) {
		t.Fatal("no file, no credential")
	}
	if err := os.WriteFile(filepath.Join(home, "credentials.json"), []byte(`{"x":{"type":"api_key"}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if !HasCredential(home) {
		t.Fatal("a stored key must count")
	}
}
