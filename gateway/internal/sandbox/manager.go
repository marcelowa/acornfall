// Package sandbox keeps every model-driven touch of the world inside one microVM per
// workspace: commands, file reads, file writes, and the workspace's own resource files.
// See docs/adr/0012-sandbox.md for the decision and the measurements behind it.
//
// Two sides, one engine. Control owns the sandbox's life with the engine's command line
// (this package: install the engine, create, start, stop, remove) and the worker owns
// execution inside it with the engine's SDK (worker/src). The two speak to the same engine
// and the same state, which is why one side can be Go and the other JavaScript.
//
// Nothing above this file names an engine. `Driver` is the seam: a different sandbox — a
// different microVM manager, a container runtime, bubblewrap where there is no hypervisor —
// is a new file implementing it, not a change to control, the interface, or the worker's
// contract.
package sandbox

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"time"
)

// ErrUnavailable is what a caller gets when the sandbox cannot be run on this machine: no
// engine artifact for the platform, a hypervisor that is not usable, or an install that
// failed. It exists to be refused on, loudly, rather than worked around: an agent that
// silently ran unconfined would be worse than one that did not run.
var ErrUnavailable = errors.New("sandbox unavailable")

// Driver is one sandbox engine. Everything above it — the workspace lifecycle, the state
// frames, the worker's flags — is engine-neutral; everything specific to how one engine is
// installed and driven stays behind this interface.
type Driver interface {
	// Name identifies the engine to the worker, which uses the same engine's SDK. The two
	// must agree, so this is what control passes along when it starts a workspace.
	Name() string
	Version() string
	// Isolated reports whether what runs here is separated from the host. The host engine is
	// the one that is not, and every surface that describes the sandbox has to say so.
	Isolated() bool
	// InstallDir is where the engine itself lives; StateDir is where its sandboxes, images,
	// and snapshots live. Both are inside the installation folder so that removing
	// acornfall removes all of it.
	InstallDir() string
	StateDir() string
	// Env is what a process needs in its environment to find this engine's sandboxes. The
	// worker attaches with the engine's SDK, so it has to look in the same place control
	// created the sandbox: this is how the two agree, without control knowing the engine's
	// variable names.
	Env() []string
	// Installed reports whether the engine is already on disk.
	Installed() bool
	// Install fetches the engine, verifying what it downloads. It is a no-op when the
	// engine is already installed.
	Install(ctx context.Context, log func(string, ...any)) error
	// Usable reports whether a sandbox can actually boot here — the hypervisor, the kernel
	// facility, the permissions. It is checked before anything is created so that the
	// refusal is an explanation rather than a crash.
	Usable() error
	// Nesting reports whether a sandbox on this machine could nest virtual machines, and why
	// not when it could not. It is a capability, not a policy: whether a workspace asks for
	// nesting is the policy's business, and the two have to agree before the engine hears
	// about it. See docs/adr/0018-disable-vm-nesting.md.
	Nesting(ctx context.Context) NestingSupport
	// List reports every sandbox the engine knows about, ours or not.
	List(ctx context.Context) ([]Instance, error)
	// Create makes a sandbox from a policy and boots it.
	Create(ctx context.Context, policy Policy, policyDir string) error
	// Start boots a sandbox that exists and is stopped.
	Start(ctx context.Context, name string) error
	// Stop shuts a sandbox down, keeping everything it accumulated.
	Stop(ctx context.Context, name string) error
	// Remove deletes a sandbox and everything in it.
	Remove(ctx context.Context, name string) error
}

// Instance is one sandbox as an engine reports it.
type Instance struct {
	Name   string `json:"name"`
	Image  string `json:"image"`
	Status string `json:"status"`
}

// Running is the engine's word for a sandbox that can take a command.
func (i Instance) Running() bool { return strings.EqualFold(i.Status, "running") }

// Options configures a manager. Home and Driver are required.
type Options struct {
	// Home is the acornfall installation folder.
	Home string
	// Driver is the engine in use.
	Driver Driver
	// Log reports what the manager does, one line at a time. Nil silences it.
	Log func(string, ...any)
	// ReportOnly never installs anything, which is what doctor wants: describe the machine,
	// change nothing. Otherwise the engine is installed at Open and again on first use, in
	// case the first attempt failed.
	ReportOnly bool
}

// Manager owns the engine and this machine's sandboxes. It is engine-neutral: it knows how
// to decide whether a sandbox can be made and when to ask the driver for one, and nothing
// about how that happens.
type Manager struct {
	home   string
	driver Driver
	log    func(string, ...any)
	report bool
	// mu guards the problem below: several workspaces can start at once, and two of them
	// must not install the engine at the same time.
	mu sync.Mutex
	// problem is why sandboxes cannot be used, if they cannot. It is a state rather than a
	// construction failure: the rest of the gateway works without a sandbox, and the tools
	// refuse, which is the point.
	problem error
}

// Open wires up the engine. It fails only on a mistake the caller can fix (no home
// directory, no driver) and it installs nothing: fetching 26MB is first use's business, not
// a gateway start's. An unusable sandbox is reported through Problem and enforced by
// Produce, so that a machine without a hypervisor can still run everything else.
func Open(ctx context.Context, opts Options) (*Manager, error) {
	if strings.TrimSpace(opts.Home) == "" {
		return nil, errors.New("sandbox: Home is required")
	}
	if opts.Driver == nil {
		return nil, errors.New("sandbox: Driver is required")
	}
	_ = ctx
	manager := &Manager{home: opts.Home, driver: opts.Driver, log: opts.Log, report: opts.ReportOnly}
	// A report has to answer "can this machine sandbox?" now, so a missing engine is its
	// problem to state. Nothing is installed on its behalf.
	if opts.ReportOnly && !opts.Driver.Installed() {
		manager.problem = fmt.Errorf("%w: the engine is not installed", ErrUnavailable)
	}
	return manager, nil
}

// ensure installs the engine if it is not there yet, and records why the sandbox cannot be
// used if it is not usable. A machine that cannot sandbox is a state, not a gateway that
// will not boot.
//
// A failure is remembered rather than retried: the reason is almost always something a
// person has to fix (a missing hypervisor, a group, a network), and hammering it from every
// workspace would produce a log that says the same thing many times.
func (m *Manager) ensure(ctx context.Context) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.problem != nil {
		return m.problem
	}
	if !m.driver.Installed() {
		if err := m.driver.Install(ctx, m.log); err != nil {
			m.problem = err
			return err
		}
	}
	if err := m.driver.Usable(); err != nil {
		m.problem = err
		return err
	}
	return nil
}

// Driver is the engine in use, for callers that need to name it.
func (m *Manager) Driver() Driver { return m.driver }

// Nesting reports what this machine's engine says about nesting: a capability of the engine
// and the machine, the same for every workspace, which the policy and this have to agree on
// before the engine is told anything.
func (m *Manager) Nesting(ctx context.Context) NestingSupport { return m.driver.Nesting(ctx) }

// Problem is why sandboxes cannot be used here, or nil. Callers record it; they do not
// decide it.
func (m *Manager) Problem() error {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.problem
}

// Report describes the sandbox tier for doctor: what is installed, where it keeps its
// state, and what is wrong if anything is.
type Report struct {
	Engine    string `json:"engine"`
	Version   string `json:"version"`
	Installed bool   `json:"installed"`
	Path      string `json:"path"`
	StateDir  string `json:"stateDir"`
	// Isolated says whether this engine separates commands from the host; false for host.
	Isolated bool   `json:"isolated"`
	Problem  string `json:"problem,omitempty"`
}

func (m *Manager) Report() Report {
	m.mu.Lock()
	defer m.mu.Unlock()
	report := Report{
		Engine:    m.driver.Name(),
		Version:   m.driver.Version(),
		Installed: m.driver.Installed(),
		Path:      m.driver.InstallDir(),
		StateDir:  m.driver.StateDir(),
		Isolated:  m.driver.Isolated(),
	}
	if m.problem != nil {
		report.Problem = m.problem.Error()
	}
	return report
}

// Produce makes sure a workspace's sandbox exists and is running, and returns its name.
//
// It never recreates an existing sandbox: the sandbox is where a workspace's dependencies
// and caches live, so replacing it would throw away work. A changed policy applies to the
// next sandbox, which is the price of not deleting the user's environment.
func (m *Manager) Produce(ctx context.Context, policy Policy, dir string) (string, error) {
	// First use is what installs the engine, so a gateway starts fast and a machine that
	// cannot sandbox says so when it matters.
	if err := m.ensure(ctx); err != nil {
		return "", err
	}
	if strings.TrimSpace(policy.Workspace) == "" {
		return "", errors.New("sandbox: policy has no workspace")
	}
	name := Name(policy.Workspace)
	instances, err := m.driver.List(ctx)
	if err != nil {
		return "", err
	}
	for _, instance := range instances {
		if instance.Name != name {
			continue
		}
		if instance.Running() {
			return name, nil
		}
		if err := m.driver.Start(ctx, name); err != nil {
			return "", err
		}
		return name, nil
	}
	if err := m.driver.Create(ctx, policy, dir); err != nil {
		return "", err
	}
	return name, nil
}

// Stop shuts a workspace's sandbox down, keeping everything it accumulated. The engine also
// stops idle sandboxes on its own, so this is for when we know sooner.
func (m *Manager) Stop(ctx context.Context, workspace string) error {
	if problem := m.Problem(); problem != nil {
		return problem
	}
	return ignoreMissing(m.driver.Stop(ctx, Name(workspace)))
}

// Remove deletes a workspace's sandbox and everything in it. Called when the workspace is
// forgotten, and the only thing that discards the sandbox's accumulated state.
func (m *Manager) Remove(ctx context.Context, workspace string) error {
	if problem := m.Problem(); problem != nil {
		return problem
	}
	return ignoreMissing(m.driver.Remove(ctx, Name(workspace)))
}

// Status is one sandbox's status, or "" when there is no such sandbox.
func (m *Manager) Status(ctx context.Context, workspace string) (string, error) {
	instances, err := m.driver.List(ctx)
	if err != nil {
		return "", err
	}
	name := Name(workspace)
	for _, instance := range instances {
		if instance.Name == name {
			return instance.Status, nil
		}
	}
	return "", nil
}

// Timeout bounds engine calls that should never take long. Creating a sandbox pulls an image
// on first use, so it is not under this.
const Timeout = 60 * time.Second

// ignoreMissing treats "there is no such sandbox" as success: stopping or removing what is
// not there is already the wanted state. Any other failure is the engine's and is reported.
func ignoreMissing(err error) error {
	if err == nil {
		return err
	}
	if strings.Contains(strings.ToLower(err.Error()), "not found") {
		return nil
	}
	return err
}
