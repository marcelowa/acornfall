package update

import (
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The file a person's command writes, in the three values it may hold. Anything else is refused by
// name, because a file the service cannot read is a machine nobody starts and nothing that says why.
func TestAPersonAsksForOneOfThreeThings(t *testing.T) {
	for _, intent := range []Intent{IntentRunning, IntentStopped, IntentGone} {
		root := t.TempDir()
		if err := WriteMachineIntent(root, intent); err != nil {
			t.Fatalf("%s: %v", intent, err)
		}
		if got := ReadMachineIntent(root); got != intent {
			t.Errorf("wrote %q, read %q", intent, got)
		}
		if want := intent == IntentRunning; WantsRunning(root) != want {
			t.Errorf("%q: WantsRunning = %v, want %v", intent, WantsRunning(root), want)
		}
	}
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Dir(MachineIntentPath(root)), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := WriteMachineIntent(root, IntentRunning); err != nil {
		t.Fatal(err)
	}
	for _, refused := range []Intent{"", "restart", "Running", "../../gone"} {
		if err := WriteMachineIntent(root, refused); err == nil {
			t.Errorf("%q should not be writable", refused)
		}
	}
	if got := ReadMachineIntent(root); got != IntentRunning {
		t.Errorf("a refused write changed the file: %q", got)
	}
	entries, err := os.ReadDir(filepath.Dir(MachineIntentPath(root)))
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if entry.Name() != "machine.json" {
			t.Errorf("a temporary was left behind: %s", entry.Name())
		}
	}
}

// Reading is total: a host with no file, an empty one, one that is not JSON and a value that is not
// a declaration are all "nothing declared". The service must not start a machine, crash or report an
// error on the strength of a file it could not read.
func TestADeclarationIsToleratedWhenItIsNotThere(t *testing.T) {
	root := t.TempDir()
	if got := ReadMachineIntent(root); got != "" {
		t.Errorf("no file is no declaration, got %q", got)
	}
	if err := os.MkdirAll(filepath.Dir(MachineIntentPath(root)), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, payload := range []string{"", "   \n", "{not json", `{"wanted":"maybe"}`, `{"wanted":7}`, `{"other":"running"}`} {
		if err := os.WriteFile(MachineIntentPath(root), []byte(payload), 0o644); err != nil {
			t.Fatal(err)
		}
		if got := ReadMachineIntent(root); got != "" {
			t.Errorf("%q read as %q, want nothing declared", payload, got)
		}
		if WantsRunning(root) {
			t.Errorf("%q made the service think a person wanted the machine", payload)
		}
	}
}

// A write that cannot happen says what it could not do, naming the folder: a command that reports
// success and left no file is a machine the service will not start.
func TestADeclarationThatCannotBeWrittenSaysWhere(t *testing.T) {
	root := t.TempDir()
	blocked := filepath.Join(root, "state", "machine.json")
	if err := os.MkdirAll(filepath.Dir(blocked), 0o755); err != nil {
		t.Fatal(err)
	}
	// A directory where the file belongs: the rename cannot replace it.
	if err := os.MkdirAll(blocked, 0o755); err != nil {
		t.Fatal(err)
	}
	err := WriteMachineIntent(root, IntentRunning)
	if err == nil {
		t.Fatal("a file that cannot be written must be an error")
	}
	if !strings.Contains(err.Error(), "machine.json") {
		t.Errorf("the error should name the file: %v", err)
	}
	if errors.Is(err, ErrNotARelease) {
		t.Errorf("a write failure is not a refusal of the value: %v", err)
	}
}
