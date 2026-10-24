package ready

import (
	"os"
	"path/filepath"
	"testing"
)

func testInput(home string) Input {
	return Input{
		Machinery:       home,
		Current:         "v0.9.0",
		Worker:          "v0.9.0",
		BunPath:         filepath.Join(home, "tools", "bun-1.4.3", "bun"),
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
	// The hypervisor is a device this machine either has or does not: point it at one the test
	// made, or the test asserts whatever machine it happens to run on.
	device := filepath.Join(t.TempDir(), "kvm")
	if err := os.WriteFile(device, nil, 0o666); err != nil {
		t.Fatal(err)
	}
	was := devKVM
	devKVM = device
	t.Cleanup(func() { devKVM = was })
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
	// The file, not the folder: the credential lives in the root's config folder (ADR 0022).
	credentials := filepath.Join(t.TempDir(), "config", "credentials.json")
	if HasCredential(credentials) {
		t.Fatal("no file, no credential")
	}
	if err := os.MkdirAll(filepath.Dir(credentials), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(credentials, []byte(`{"x":{"type":"api_key"}}`), 0o600); err != nil {
		t.Fatal(err)
	}
	if !HasCredential(credentials) {
		t.Fatal("a stored key must count")
	}
}

func TestWorkerSkewAgainstBinarySatisfies(t *testing.T) {
	home := t.TempDir()
	input := testInput(home)
	input.Current = "v0.9.8"
	input.RuntimeTag = "v0.9.9"
	input.Worker = "v0.9.9"
	if requirement := byName(Check(input), "worker"); !requirement.OK {
		t.Fatalf("sources matching the binary must satisfy: %+v", requirement)
	}
}

// The state this was found in: the node exists, and the container cannot open it. "present" was
// the wrong answer, and it was a green line that hid a /dev/kvm no workspace could use.
func TestAKVMThatCannotBeOpenedIsNotAHypervisor(t *testing.T) {
	device := filepath.Join(t.TempDir(), "kvm")
	if err := os.WriteFile(device, nil, 0o000); err != nil {
		t.Fatal(err)
	}
	was := devKVM
	devKVM = device
	t.Cleanup(func() { devKVM = was })

	requirement := byName(Check(testInput(t.TempDir())), "hypervisor")
	if requirement.OK {
		t.Fatal("a /dev/kvm this user cannot open was reported as a working hypervisor")
	}
	if requirement.Fix == "" {
		t.Error("the refusal does not say what to do about it")
	}
}
