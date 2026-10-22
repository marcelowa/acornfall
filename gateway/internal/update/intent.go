package update

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// The person's intent, next to the product's (ADR 0030, amended). The product says which release it
// wants in want.json, inside the mount; a person says whether the machine should exist at all in
// machine.json, on the host. The host service enforces both and decides neither: `machine down`
// used to be undone by the next tick, because nothing recorded that anyone had asked for it.

// Intent is what a person told the host service to do with the machine.
type Intent string

const (
	// IntentRunning means the machine should be up: the service starts it, restarts it when it
	// exits, and boots it after an update.
	IntentRunning Intent = "running"
	// IntentStopped means the machine is shut down and left there: the record and the disk stay, and
	// the service does not start it.
	IntentStopped Intent = "stopped"
	// IntentGone means the machine was taken away on purpose: the service does nothing at all.
	IntentGone Intent = "gone"
)

// MachineIntentPath is the file a person's command writes: `$ROOT/state/machine.json`.
func MachineIntentPath(root string) string { return filepath.Join(root, "state", "machine.json") }

// Declaration is the whole of what a person said about the machine: whether it should run, and the address
// its console is published on. The address lives here rather than in flags because the machine's address is
// fixed when it is created, and two places that can disagree decide it by whoever runs last (ADR 0030,
// amended). Absent host and port read as loopback and 7777, so a file written before this keeps working.
type Declaration struct {
	Wanted Intent `json:"wanted,omitempty"`
	Host   string `json:"host,omitempty"`
	Port   int    `json:"port,omitempty"`
}

// Address is where the console is published, with the defaults an older file means.
func (d Declaration) Address() (string, int) {
	host, port := d.Host, d.Port
	if strings.TrimSpace(host) == "" || strings.ContainsAny(host, "/ \t") {
		host = "127.0.0.1"
	}
	if port < 1 || port > 65535 {
		port = 7777
	}
	return host, port
}

// ReadDeclaration reads the file, tolerantly like the rest of the host's files: a missing, empty or broken
// one is nothing declared, and an absent address is the default one.
func ReadDeclaration(root string) Declaration {
	if root == "" {
		return Declaration{}
	}
	payload, err := os.ReadFile(MachineIntentPath(root))
	if err != nil || len(strings.TrimSpace(string(payload))) == 0 {
		return Declaration{}
	}
	var declaration Declaration
	if err := json.Unmarshal(payload, &declaration); err != nil {
		return Declaration{}
	}
	if intent := Intent(strings.TrimSpace(string(declaration.Wanted))); intent != IntentRunning && intent != IntentStopped && intent != IntentGone {
		declaration.Wanted = ""
	}
	declaration.Host = strings.TrimSpace(declaration.Host)
	return declaration
}

// WriteDeclaration records the whole declaration, atomically.
func WriteDeclaration(root string, declaration Declaration) error {
	payload, err := json.Marshal(declaration)
	if err != nil {
		return err
	}
	return writeFileAtomic(MachineIntentPath(root), append(payload, '\n'))
}

// WantsRunning is the one place that answers "should this machine be running?". Only a declaration a
// person's command wrote makes it so: a missing, empty or unparsable file is a host where a person
// drives, which is what an install was before there was a service.
func WantsRunning(root string) bool { return ReadMachineIntent(root) == IntentRunning }

// ReadMachineIntent reads the declaration. It is deliberately total: a missing file, an empty one, a
// file that is not JSON and a value that is not one of the three are all "nothing declared" with no
// error. The service must not fail or start a machine on the strength of a file it could not read,
// and a person debugging a typo should not find a crash loop where they expected silence.
func ReadMachineIntent(root string) Intent {
	if root == "" {
		return ""
	}
	payload, err := os.ReadFile(MachineIntentPath(root))
	if err != nil || len(strings.TrimSpace(string(payload))) == 0 {
		return ""
	}
	var declaration struct {
		Wanted string `json:"wanted"`
	}
	if err := json.Unmarshal(payload, &declaration); err != nil {
		return ""
	}
	switch intent := Intent(strings.TrimSpace(declaration.Wanted)); intent {
	case IntentRunning, IntentStopped, IntentGone:
		return intent
	default:
		return ""
	}
}

// WriteMachineIntent records what a person asked for. Only a command on the host writes this file:
// `machine serve` reads it and never sets it, or the service would be deciding whether a machine
// exists rather than enforcing what a person said (ADR 0030, amended).
func WriteMachineIntent(root string, intent Intent) error {
	switch intent {
	case IntentRunning, IntentStopped, IntentGone:
	default:
		return fmt.Errorf("%q is not something a person can ask for: running, stopped or gone", string(intent))
	}
	// The address is the person's too, and writing the intent must not drop it: a machine taken down and
	// brought back keeps the address it was created with.
	declaration := ReadDeclaration(root)
	declaration.Wanted = intent
	return WriteDeclaration(root, declaration)
}
