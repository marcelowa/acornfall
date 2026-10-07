package sandbox

import (
	"context"
	"errors"
)

// Host is the engine that does not sandbox anything: commands and file operations happen on
// the host, in the workspace, with the user's own permissions and reach.
//
// It exists because the worker's only door to a workspace is its sandbox engine, so a machine
// without a hypervisor has no workspace resources at all — and because a development loop or
// a test suite may want the workspace's features without paying for a microVM. It is never
// chosen automatically: a run that does not name it gets microsandbox and, without a
// hypervisor, refuses. Choosing it is a decision the operator makes, and doctor, the state
// frame, and the startup log all say it is not isolated. See docs/adr/0015-host-engine.md.
type Host struct{}

// NewHost builds the driver. Unlike the microVM engine it installs nothing.
func NewHost() *Host { return &Host{} }

func (h *Host) Name() string { return "host" }

// Version is empty: there is no release to report for "the host you are on".
func (h *Host) Version() string { return "" }

// Isolated reports that nothing separates a command from the host. The state says so, because
// a client that showed a sandbox badge for this engine would be lying.
func (h *Host) Isolated() bool { return false }

// InstallDir and StateDir are empty: this engine has no artifacts and keeps no state. A
// caller with work to store has the workspace and the installation folder.
func (h *Host) InstallDir() string { return "" }
func (h *Host) StateDir() string   { return "" }

// Env is empty: there is no engine store for the worker to find.
func (h *Host) Env() []string { return nil }

func (h *Host) Installed() bool { return true }

func (h *Host) Install(context.Context, func(string, ...any)) error { return nil }

// Usable is always true. It is the reason this engine exists: no hypervisor, no kernel
// facility, no group — just the machine the gateway already runs on.
func (h *Host) Usable() error { return nil }

// List reports nothing: there are no sandboxes to list. Each workspace is its own folder.
func (h *Host) List(context.Context) ([]Instance, error) { return nil, nil }

// Create does nothing. Nothing is made for a workspace that runs on the host; the workspace
// folder is the sandbox.
func (h *Host) Create(context.Context, Policy, string) error { return nil }

func (h *Host) Start(context.Context, string) error  { return nil }
func (h *Host) Stop(context.Context, string) error   { return nil }
func (h *Host) Remove(context.Context, string) error { return nil }

// Engines are the drivers this build can run, by the name the worker matches with its own
// client. An unknown name is refused with the list, never silently defaulted: a run that
// meant microsandbox and got the host would be a security change nobody asked for.
func Engine(home, state, name string) (Driver, error) {
	switch name {
	case "", "microsandbox":
		driver := NewMicrosandbox(home)
		if state != "" {
			driver = driver.WithStateDir(state)
		}
		return driver, nil
	case "host":
		return NewHost(), nil
	default:
		return nil, errors.New("sandbox: unknown engine " + name + " (microsandbox, host)")
	}
}
