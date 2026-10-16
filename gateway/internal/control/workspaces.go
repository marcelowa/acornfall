// Package control's workspace layer: the install's registry of workspaces and one
// Control per started workspace.
//
// A Control owns one storage, and conversation ids are only unique inside a storage, so
// "which workspace" has to be answered before anything else can be looked up. That is what
// this file does: it routes, it starts workers lazily, and it keeps the registry.
// See docs/adr/0011-workspaces.md.
package control

import (
	"github.com/acornfall/acornfall/gateway/internal/sandbox"

	"context"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/acornfall/acornfall/gateway/internal/protocol"

	"github.com/acornfall/acornfall/gateway/internal/workerpool"
)

// GeneralWorkspaceName is where conversations land when nothing else is chosen. It exists
// in every install.
const GeneralWorkspaceName = "general"

// DefaultWorkspacesDir is where workspaces are created. It is deliberately outside the
// hidden installation folder: this is the reader's own content, and it should be somewhere
// they would look.
//
// An install without a home directory gets an error rather than a relative guess: workspaces
// would otherwise land wherever the process happened to start, which is not a place anyone
// chose and is how a folder of them appears in a container's working directory.
func DefaultWorkspacesDir() (string, error) {
	home, err := os.UserHomeDir()
	if err != nil {
		return "", fmt.Errorf("cannot tell where to create workspaces: %w (pass --workspaces-dir)", err)
	}
	return filepath.Join(home, "acornfall", "workspaces"), nil
}

// Workspace is a folder the agent works in, plus the decisions that belong to it.
type Workspace struct {
	Name  string `json:"name"`
	Path  string `json:"path"`
	Title string `json:"title"`
	// General marks the default workspace. Exactly one workspace is general.
	General bool `json:"general"`
	// Image is the sandbox's environment for this workspace: the project's toolchain, not
	// ours. Empty means the default, and changing it takes effect at the next sandbox
	// because the running one is where the workspace's dependencies live.
	Image string `json:"image,omitempty"`
	// Network is whether the sandbox may reach the network: "on", "off", or empty for the
	// default, which is on. A string rather than a bool so that "not set" is expressible —
	// and so an allowlist can be added later without a migration.
	Network string `json:"network,omitempty"`
	// DisableVMNesting is whether this workspace's sandbox must not nest virtual machines:
	// run a hypervisor inside it. Nil means "not set", which follows the install's
	// --disable-vm-nesting; a pointer because true is a choice and absent is not. Like Image,
	// it takes effect at the next sandbox, because nesting is decided when one is created.
	DisableVMNesting *bool `json:"disable_vm_nesting,omitempty"`
	// Running is runtime state, never stored: a persisted `true` would be a claim about a
	// process that does not exist after a restart.
	Running bool `json:"-"`
}

// NetworkOff is the one non-default value Network has today.
const NetworkOff = "off"

// SandboxPolicy is what this workspace's sandbox is allowed to be. It is derived rather than
// stored so that a new field cannot be forgotten in one of the two places. `home` is the
// installation folder and `userHome` is the user's, because the global resources live in two
// places and the worker reads both: the sandbox mounts the same paths at the same strings.
// `disableVMNesting` is the install's own answer, --disable-vm-nesting, and a workspace's
// own setting wins over it.
func (w Workspace) SandboxPolicy(home, userHome string, disableVMNesting bool) sandbox.Policy {
	if w.DisableVMNesting != nil {
		disableVMNesting = *w.DisableVMNesting
	}
	return sandbox.Policy{
		Image:            w.Image,
		Workspace:        w.Path,
		Egress:           w.Network != NetworkOff,
		DisableVMNesting: disableVMNesting,
		Global:           sandbox.GlobalPaths(home, userHome),
	}
}

// ValidNetwork reports whether a network value means something. An unknown value is refused
// rather than ignored: a caller asking for "maybe" should be told, not humoured.
func ValidNetwork(value string) bool {
	return value == "" || value == "on" || value == NetworkOff
}

// Views renders workspaces for the interface, which is the only place `running` belongs.
//
// A conversion rather than a field-by-field copy, because the two shapes are the same shape:
// a field added to one and not the other is then a compile error instead of a value that
// quietly stops reaching the interface.
func Views(list []Workspace) []WorkspaceState {
	views := make([]WorkspaceState, 0, len(list))
	for _, workspace := range list {
		views = append(views, WorkspaceState(workspace))
	}
	return views
}

// WorkspacesOptions configures the workspace layer.
type WorkspacesOptions struct {
	// Home is the installation folder: global resources, credentials, and state.
	Home string
	// UserHome is the user's home folder, where `~/.agents` lives. It is resolved at the
	// entry point so that the sandbox mount list and the worker's reads are built from the
	// same answer.
	UserHome string
	// GeneralPath is the general workspace's folder, from --workspace.
	GeneralPath string
	// WorkspacesDir is where workspaces are created, from --workspaces-dir. Empty means
	// the registry's value, and failing that the default.
	WorkspacesDir string
	WorkerCommand []string
	WorkerDir     string
	// Update reports the self-update summary for the state stream.
	Update func() UpdateSummary
	// Model is the install default, from --model.
	Model string
	// Sandbox is the machine's sandbox tier, shared by every workspace.
	Sandbox *sandbox.Manager
	// DisableVMNesting is the install default from --disable-vm-nesting: a workspace's
	// sandbox nests when the engine and the machine can, unless a workspace refuses it.
	DisableVMNesting bool
}

// Workspaces is the install: a registry of workspaces and their started Controls.
type Workspaces struct {
	opts WorkspacesOptions

	// mu guards the registry and the controls.
	//
	// Lock order, and it is not a preference: **registry before control, never the
	// reverse.** `List` and the eviction sweep read a control while holding this, so a
	// path that read the registry while holding a control would make two orders out of one
	// pair of locks, and a pending writer on either side would then hang every request
	// that touches both — which is every request. `TestStateDoesNotTakeTheRegistryLockInsideItsOwn`
	// checks the one place that had it backwards.
	mu       sync.RWMutex
	dir      string
	registry map[string]Workspace
	controls map[string]*Control
	starting map[string]*sync.Mutex
	closed   bool

	// used is guarded by usedMu rather than by mu, because it changes on every request:
	// taking the registry's write lock to store a timestamp would put the hot path in
	// front of everything that reads the registry. It is a leaf lock, never held while
	// taking another.
	usedMu sync.Mutex
	used   map[string]time.Time
}

func NewWorkspaces(opts WorkspacesOptions) *Workspaces {
	return &Workspaces{
		opts:     opts,
		registry: map[string]Workspace{},
		controls: map[string]*Control{},
		used:     map[string]time.Time{},
		starting: map[string]*sync.Mutex{},
	}
}

// Dir is the folder workspaces are created in.
func (w *Workspaces) Dir() string {
	w.mu.RLock()
	defer w.mu.RUnlock()
	return w.dir
}

// Open loads the registry, seeding the general workspace on first run, and starts it so
// the interface has somewhere to land.
func (w *Workspaces) Open(ctx context.Context) error {
	if err := w.loadRegistry(); err != nil {
		return err
	}
	if err := os.MkdirAll(w.Dir(), 0o755); err != nil {
		return err
	}
	if err := w.migrate(); err != nil {
		return err
	}
	if _, err := w.Ensure(ctx, GeneralWorkspaceName); err != nil {
		// Logged, not fatal: the general workspace is where a client lands, but a client can
		// still be told what is wrong with it. Exiting here would leave nothing to talk to.
		workerpool.Log("general workspace: %v", err)
	}
	go w.evictIdle(ctx)
	return nil
}

func (w *Workspaces) Close() {
	w.mu.Lock()
	controls := make([]*Control, 0, len(w.controls))
	for _, control := range w.controls {
		controls = append(controls, control)
	}
	w.controls = map[string]*Control{}
	w.closed = true
	w.mu.Unlock()
	for _, control := range controls {
		control.Close()
	}
}

const (
	registryFile = "workspaces.json"
	// A warm worker costs a process. Keeping every workspace the reader has visited alive
	// forever would turn a few visits into a few hundred megabytes, so an idle one that
	// nobody is watching is stopped and started again from its own storage.
	idleEviction  = 15 * time.Minute
	evictionSweep = time.Minute
)

// List returns the registry, general first and then by name. It includes whether each
// workspace's worker is running, because that is the difference between switching to a
// workspace and waiting for one to start.
func (w *Workspaces) List() []Workspace {
	w.mu.RLock()
	defer w.mu.RUnlock()
	list := make([]Workspace, 0, len(w.registry))
	for _, workspace := range w.registry {
		if control, started := w.controls[workspace.Name]; started {
			workspace.Running = control.WorkerUp()
		}
		list = append(list, workspace)
	}
	sort.Slice(list, func(i, j int) bool {
		if list[i].General != list[j].General {
			return list[i].General
		}
		return list[i].Name < list[j].Name
	})
	return list
}

// Get returns one workspace by name.
func (w *Workspaces) Get(name string) (Workspace, bool) {
	w.mu.RLock()
	defer w.mu.RUnlock()
	workspace, ok := w.registry[name]
	return workspace, ok
}

// Create makes a workspace inside the workspaces folder. This is the only way the API
// creates one, which is what keeps the interface inside a single directory: a folder
// anywhere else on the machine is an operator's decision, not a form field.
//
// A folder of that name already there is adopted rather than refused, so a workspace the
// reader prepared themselves works.
func (w *Workspaces) Create(name string) (Workspace, error) {
	if strings.TrimSpace(name) == "" {
		return Workspace{}, errors.New("a workspace needs a name")
	}
	if strings.ContainsAny(name, "/\\ ") {
		return Workspace{}, fmt.Errorf("a workspace name cannot contain a slash or a space: %q", name)
	}
	path := filepath.Join(w.Dir(), name)
	if err := os.MkdirAll(path, 0o755); err != nil {
		return Workspace{}, err
	}
	workspace := Workspace{Name: name, Path: path, Title: name}
	if err := w.Add(workspace); err != nil {
		return Workspace{}, err
	}
	return workspace, nil
}

// Add registers a workspace at a folder of the caller's choosing. The API does not use it;
// the CLI and anyone editing the registry do.
func (w *Workspaces) Add(workspace Workspace) error {
	if err := validateWorkspace(workspace); err != nil {
		return err
	}
	w.mu.Lock()
	if _, exists := w.registry[workspace.Name]; exists {
		w.mu.Unlock()
		return fmt.Errorf("workspace %q already exists", workspace.Name)
	}
	w.registry[workspace.Name] = workspace
	w.mu.Unlock()
	return w.persist()
}

// Update replaces a workspace record. The name may not change: it is the identity every
// route uses, and renaming would orphan conversations that nothing else references.
func (w *Workspaces) Update(workspace Workspace) error {
	if err := validateWorkspace(workspace); err != nil {
		return err
	}
	w.mu.Lock()
	existing, exists := w.registry[workspace.Name]
	if !exists {
		w.mu.Unlock()
		return fmt.Errorf("no workspace %q", workspace.Name)
	}
	// An existing record keeps its general flag: exactly one workspace is general, and it
	// is not this call's to change.
	workspace.General = existing.General
	workspace.Name = existing.Name
	w.registry[workspace.Name] = workspace
	control := w.controls[workspace.Name]
	// The folder is passed to the worker when it starts, so a change only takes effect in a
	// new process. Stopping it here is what makes a move mean something immediately instead of
	// at the next idle eviction.
	restart := control != nil && existing.Path != workspace.Path
	if restart {
		delete(w.controls, workspace.Name)
	}
	w.mu.Unlock()
	if restart {
		control.Close()
		workerpool.Log("workspace %s stopped: its record changed", workspace.Name)
	} else if control != nil {
		control.SetWorkspace(workspace)
	}
	return w.persist()
}

// Remove forgets a workspace. It never touches the folder or the history, the same way
// deleting a conversation is a tombstone rather than a delete.
func (w *Workspaces) Remove(ctx context.Context, name string) error {
	if name == GeneralWorkspaceName {
		return errors.New("the general workspace cannot be removed")
	}
	w.mu.Lock()
	workspace, exists := w.registry[name]
	if !exists {
		w.mu.Unlock()
		return fmt.Errorf("no workspace %q", name)
	}
	control := w.controls[name]
	delete(w.registry, name)
	delete(w.controls, name)
	w.mu.Unlock()
	w.forgetUsed(name)
	if control != nil {
		control.Close()
	}
	// The sandbox is deleted with the workspace: it is the one thing that holds what the
	// agent accumulated inside it, and leaving it behind would leak a disk per forgotten
	// workspace. A failure is reported and does not stop the removal the user asked for.
	if manager := w.opts.Sandbox; manager != nil {
		if err := manager.Remove(ctx, workspace.Path); err != nil && !errors.Is(err, sandbox.ErrUnavailable) {
			workerpool.Log("removing the sandbox for %s: %v", name, err)
		}
	}
	return w.persist()
}

// Ensure returns the Control for a workspace, starting its worker if this is the first
// use. The general workspace cannot be missing; any other name must be registered.
func (w *Workspaces) Ensure(ctx context.Context, name string) (*Control, error) {
	if name == "" {
		name = GeneralWorkspaceName
	}
	w.mu.RLock()
	workspace, known := w.registry[name]
	control := w.controls[name]
	closed := w.closed
	starter := w.starting[name]
	w.mu.RUnlock()
	if closed {
		return nil, errors.New("the workspace layer is closed")
	}
	if !known {
		return nil, fmt.Errorf("no workspace %q", name)
	}
	if control != nil {
		w.markUsed(name)
		return control, nil
	}

	// One starter per workspace, so two concurrent requests cannot spawn two workers over
	// one storage: the second would find it locked, or worse, write to it.
	w.mu.Lock()
	if starter == nil {
		starter = &sync.Mutex{}
		w.starting[name] = starter
	}
	w.mu.Unlock()
	starter.Lock()
	defer starter.Unlock()

	w.mu.RLock()
	control = w.controls[name]
	w.mu.RUnlock()
	if control != nil {
		w.markUsed(name)
		return control, nil
	}

	control = New(Options{
		Workspace:        workspace,
		Credentials:      filepath.Join(w.opts.Home, "credentials.json"),
		Registry:         w.List,
		WorkspacesDir:    w.Dir(),
		Home:             w.opts.Home,
		UserHome:         w.opts.UserHome,
		StoragePath:      filepath.Join(w.opts.Home, "state", name, "session.sqlite"),
		SettingsPath:     filepath.Join(w.opts.Home, "state", name, "settings.json"),
		Sandbox:          w.opts.Sandbox,
		WorkerCommand:    w.opts.WorkerCommand,
		WorkerDir:        w.opts.WorkerDir,
		Update:           w.opts.Update,
		Model:            w.opts.Model,
		DisableVMNesting: w.opts.DisableVMNesting,
	})
	if err := os.MkdirAll(filepath.Join(w.opts.Home, "state", name), 0o700); err != nil {
		return nil, err
	}
	control.Open(ctx)
	w.mu.Lock()
	w.controls[name] = control
	w.mu.Unlock()
	w.markUsed(name)
	workerpool.Log("workspace %s started (%s)", name, workspace.Path)
	return control, nil
}

// The install-wide defaults file: <home>/settings.json. The layer that owns the file owns
// writing it, so every workspace sees one value rather than a copy each.
func (w *Workspaces) installDefaultsPath() string {
	return filepath.Join(w.opts.Home, "settings.json")
}

// SetInstallModel changes the model every workspace falls back to, below its own default
// and above the last resort.
func (w *Workspaces) SetInstallModel(ctx context.Context, provider, modelID string) error {
	if (provider == "") != (modelID == "") {
		return errors.New("a model default needs both a provider and a model id")
	}
	if provider != "" && w.noneOffer(provider, modelID) {
		return unavailableModel(provider, modelID)
	}
	return w.changeInstall(ctx, func(defaults *Defaults) error {
		defaults.Model = protocol.ModelBinding{Provider: provider, ModelID: modelID}
		return nil
	})
}

// SetInstallThinking changes the level every workspace falls back to.
func (w *Workspaces) SetInstallThinking(ctx context.Context, level string) error {
	if err := validateThinkingLevel(level); err != nil {
		return err
	}
	return w.changeInstall(ctx, func(defaults *Defaults) error {
		defaults.Thinking = level
		return nil
	})
}

// SetInstallAgent changes the definition every workspace falls back to. A definition a
// workspace keeps to itself is legitimately unknown to the others: resolution skips it where
// it is not there.
func (w *Workspaces) SetInstallAgent(ctx context.Context, name string) error {
	if name != "" && w.noDefinition(name) {
		return fmt.Errorf("no agent definition named %q", name)
	}
	return w.changeInstall(ctx, func(defaults *Defaults) error {
		defaults.Agent = name
		return nil
	})
}

// changeInstall writes the file once and tells every running workspace, so a change applies
// without a restart.
func (w *Workspaces) changeInstall(ctx context.Context, change func(*Defaults) error) error {
	path := w.installDefaultsPath()
	defaults, err := LoadDefaults(path)
	if err != nil {
		return err
	}
	if err := change(&defaults); err != nil {
		return err
	}
	// An empty layer is not a layer: leaving a file full of zeroes behind would make the
	// install look configured when it is not.
	if defaults == (Defaults{}) {
		if err := os.Remove(path); err != nil && !errors.Is(err, os.ErrNotExist) {
			return err
		}
	} else if err := SaveDefaults(path, defaults); err != nil {
		return err
	}
	for _, control := range w.running() {
		if err := control.SetInstallDefaults(ctx, defaults); err != nil {
			workerpool.Log("apply install defaults to %s: %v", control.opts.Workspace.Name, err)
		}
	}
	return nil
}

// running is a snapshot of the started workspaces, copied out so nothing is called while the
// registry lock is held.
func (w *Workspaces) running() []*Control {
	w.mu.RLock()
	defer w.mu.RUnlock()
	controls := make([]*Control, 0, len(w.controls))
	for _, control := range w.controls {
		controls = append(controls, control)
	}
	return controls
}

// StopWorkers terminates every started workspace's worker process and
// leaves warm sandboxes alone: the next open reattaches. No failure is
// possible beyond the waits inside, so there is no error to return.
func (w *Workspaces) StopWorkers() {
	for _, control := range w.running() {
		control.stopWorker()
	}
}

// AbortAll stops every running conversation in every started workspace.
// One failure does not stop the rest: an update that asked for drain-stop
// wants everything quiet, and the joined error says what stayed loud.
func (w *Workspaces) AbortAll(ctx context.Context) error {
	var errs []error
	for _, control := range w.running() {
		for _, id := range control.RunningIDs() {
			if err := control.Abort(ctx, id); err != nil {
				errs = append(errs, err)
			}
		}
	}
	return errors.Join(errs...)
}

// AnyRunning reports whether any conversation in any started workspace is running.
// Only started workspaces are asked: an unstarted worker has no runs. The update
// tier reads this before swapping binaries, so an update never lands mid-run.
func (w *Workspaces) AnyRunning() bool {
	for _, control := range w.running() {
		if control.AnyRunning() {
			return true
		}
	}
	return false
}

// RunningWorkspace names one started workspace with runs, and how many, so the
// install dialog can say what stopping runs would stop instead of saying "runs".
type RunningWorkspace struct {
	Workspace string `json:"workspace"`
	Runs      int    `json:"runs"`
}

// RunningSummary answers what a drain-stop would stop: every started workspace
// with running conversations, and the count in each, by name. The registry lock
// is released before the controls are asked, so the lock order stays registry
// before control.
func (w *Workspaces) RunningSummary() []RunningWorkspace {
	w.mu.RLock()
	named := make(map[string]*Control, len(w.controls))
	maps.Copy(named, w.controls)
	w.mu.RUnlock()
	summary := make([]RunningWorkspace, 0, len(named))
	for name, control := range named {
		if runs := len(control.RunningIDs()); runs > 0 {
			summary = append(summary, RunningWorkspace{Workspace: name, Runs: runs})
		}
	}
	sort.Slice(summary, func(i, j int) bool { return summary[i].Workspace < summary[j].Workspace })
	return summary
}

// noneOffer reports whether no started workspace offers this model. With none started there
// is nothing to check against, and refusing would make the first thing anyone does fail.
func (w *Workspaces) noneOffer(provider, modelID string) bool {
	controls := w.running()
	if len(controls) == 0 {
		return false
	}
	for _, control := range controls {
		if control.isAvailable(control.Describe(), protocol.ModelBinding{Provider: provider, ModelID: modelID}) {
			return false
		}
	}
	return true
}

func (w *Workspaces) noDefinition(name string) bool {
	controls := w.running()
	if len(controls) == 0 {
		return false
	}
	for _, control := range controls {
		control.mu.RLock()
		found := definitionExists(control.catalog.Agents, name)
		control.mu.RUnlock()
		if found {
			return false
		}
	}
	return true
}

// Route finds the workspace a request is about and the control that serves it.
func (w *Workspaces) Route(ctx context.Context, workspaceName string) (Workspace, *Control, error) {
	name := workspaceName
	if name == "" {
		name = GeneralWorkspaceName
	}
	workspace, ok := w.Get(name)
	if !ok {
		return Workspace{}, nil, fmt.Errorf("no workspace %q", name)
	}
	control, err := w.Ensure(ctx, name)
	if err != nil {
		return Workspace{}, nil, err
	}
	return workspace, control, nil
}

// markUsed records that a workspace was asked for, which is what keeps an actively used
// one from being evicted.
func (w *Workspaces) markUsed(name string) {
	w.usedMu.Lock()
	w.used[name] = time.Now()
	w.usedMu.Unlock()
}

func (w *Workspaces) forgetUsed(name string) {
	w.usedMu.Lock()
	delete(w.used, name)
	w.usedMu.Unlock()
}

// idleFor reports how long a workspace has gone unused. An unknown one is idle: it has no
// worker to keep.
func (w *Workspaces) idleFor(name string) time.Duration {
	w.usedMu.Lock()
	defer w.usedMu.Unlock()
	at, known := w.used[name]
	if !known {
		return idleEviction
	}
	return time.Since(at)
}

// evictIdle stops workers nobody is watching. The general workspace is kept: it is where a
// fresh client lands, and starting it is the first thing every visit does.
func (w *Workspaces) evictIdle(ctx context.Context) {
	ticker := time.NewTicker(evictionSweep)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			stopping := w.evictCandidates()
			for _, control := range stopping {
				control.Close()
			}
			if len(stopping) > 0 {
				workerpool.Log("stopped %d idle workspace(s)", len(stopping))
			}
		}
	}
}

// evictCandidates decides which idle workspaces to stop, and removes them from the
// controls map so nothing can start a second worker over the same storage while they are
// being closed. Closing happens outside: it waits for a process, and the registry lock is
// not a place to wait for anything.
//
// This is the one caller that reads a control while holding the registry lock, which is why
// the order is registry-then-control everywhere.
func (w *Workspaces) evictCandidates() []*Control {
	w.mu.Lock()
	defer w.mu.Unlock()
	var stopping []*Control
	for name, control := range w.controls {
		if name == GeneralWorkspaceName {
			continue
		}
		if w.idleFor(name) < idleEviction {
			continue
		}
		if control.Watching() || control.Busy() {
			continue
		}
		stopping = append(stopping, control)
		delete(w.controls, name)
	}
	return stopping
}

func validateWorkspace(workspace Workspace) error {
	if strings.TrimSpace(workspace.Name) == "" {
		return errors.New("a workspace needs a name")
	}
	if strings.ContainsAny(workspace.Name, "/\\ ") {
		return fmt.Errorf("a workspace name cannot contain a slash or a space: %q", workspace.Name)
	}
	if strings.TrimSpace(workspace.Path) == "" {
		return fmt.Errorf("workspace %q needs a folder", workspace.Name)
	}
	return nil
}

func (w *Workspaces) registryPath() string {
	return filepath.Join(w.opts.Home, registryFile)
}

// RegistryFile is the workspaces registry as it exists on disk. It has one owner so the
// server and the command line cannot disagree about its shape.
//
// WorkspacesDir is recorded here rather than in the global config because it belongs to the
// registry, and because that config is what shapes prompts: a control-plane path there
// would be a concern in the wrong file.
type RegistryFile struct {
	// Path is where it was read from; not part of the file.
	Path string `json:"-"`
	// dropped says the file mentioned keys this build no longer writes, so the caller can
	// rewrite it. Not part of the file either.
	dropped       bool
	WorkspacesDir string      `json:"workspacesDir,omitempty"`
	Workspaces    []Workspace `json:"workspaces"`
}

// droppedKeys reports whether the file on disk mentions a key this build no longer writes.
//
// A workspace used to carry `trusted`. Nothing reads it any more, and a stale value that
// nothing reads is a value something can read again by accident — so the first load that sees
// one rewrites the file without it, rather than leaving it there for a later version to
// rediscover and mistrust.
func droppedKeys(payload []byte) bool {
	var raw struct {
		Workspaces []map[string]json.RawMessage `json:"workspaces"`
	}
	if err := json.Unmarshal(payload, &raw); err != nil {
		return false
	}
	for _, record := range raw.Workspaces {
		if _, found := record["trusted"]; found {
			return true
		}
	}
	return false
}

// LoadRegistryFile reads a registry, tolerating absence.
func LoadRegistryFile(path string) (RegistryFile, error) {
	registry := RegistryFile{Path: path}
	payload, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return registry, nil
	}
	if err != nil {
		return registry, err
	}
	if err := json.Unmarshal(payload, &registry); err != nil {
		return registry, fmt.Errorf("%s: %w", path, err)
	}
	registry.Path = path
	registry.dropped = droppedKeys(payload)
	return registry, nil
}

// SaveRegistryFile writes a registry atomically and privately.
func SaveRegistryFile(registry RegistryFile) error {
	sort.Slice(registry.Workspaces, func(i, j int) bool { return registry.Workspaces[i].Name < registry.Workspaces[j].Name })
	payload, err := json.MarshalIndent(registry, "", "  ")
	if err != nil {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(registry.Path), 0o700); err != nil {
		return err
	}
	temp := registry.Path + ".tmp"
	if err := os.WriteFile(temp, append(payload, '\n'), 0o600); err != nil {
		return err
	}
	return os.Rename(temp, registry.Path)
}

func (w *Workspaces) loadRegistry() error {
	file, err := LoadRegistryFile(w.registryPath())
	if err != nil {
		return err
	}
	// Anything the file says that we no longer write is dropped on the way out, once.
	defer func() {
		if file.dropped {
			if err := w.persist(); err != nil {
				workerpool.Log("rewriting the registry without old keys: %v", err)
			}
		}
	}()
	recorded := file.WorkspacesDir
	for _, workspace := range file.Workspaces {
		w.registry[workspace.Name] = workspace
	}
	// The flag wins for this run and is recorded, so where workspaces live is a decision
	// that sticks rather than one that has to be repeated.
	dir := w.opts.WorkspacesDir
	if dir == "" {
		dir = recorded
	}
	if dir == "" {
		dir, err = DefaultWorkspacesDir()
		if err != nil {
			return err
		}
	}
	absolute, err := filepath.Abs(dir)
	if err != nil {
		return err
	}
	w.dir = absolute
	if w.opts.WorkspacesDir != "" && w.opts.WorkspacesDir != recorded {
		workerpool.Log("workspaces folder: %s", absolute)
	}
	if _, ok := w.registry[GeneralWorkspaceName]; !ok {
		// First run: the folder the install was started in is the general workspace, which
		// is what today's single-workspace install already was. Without one, it is created
		// in the workspaces folder like any other.
		path := w.opts.GeneralPath
		if path == "" {
			path = filepath.Join(w.dir, GeneralWorkspaceName)
		}
		absolute, err := filepath.Abs(path)
		if err != nil {
			return err
		}
		if err := os.MkdirAll(absolute, 0o755); err != nil {
			return err
		}
		w.registry[GeneralWorkspaceName] = Workspace{
			Name:    GeneralWorkspaceName,
			Path:    absolute,
			Title:   filepath.Base(absolute),
			General: true,
		}
		if err := w.persist(); err != nil {
			return err
		}
	}
	// Exactly one general workspace: a registry hand-edited into two is repaired by
	// keeping the first and clearing the rest.
	seenGeneral := false
	for name, workspace := range w.registry {
		if !workspace.General {
			continue
		}
		if seenGeneral {
			workspace.General = false
			w.registry[name] = workspace
			continue
		}
		seenGeneral = true
	}
	return nil
}

func (w *Workspaces) persist() error {
	w.mu.RLock()
	file := RegistryFile{Path: w.registryPath(), WorkspacesDir: w.dir, Workspaces: make([]Workspace, 0, len(w.registry))}
	for _, workspace := range w.registry {
		file.Workspaces = append(file.Workspaces, workspace)
	}
	w.mu.RUnlock()
	return SaveRegistryFile(file)
}

// migrate moves a single-workspace install onto the workspace layout: one storage and one
// settings file, moved into the general workspace's state directory. Nothing is rewritten
// inside them, so every conversation appears exactly where it was.
func (w *Workspaces) migrate() error {
	state := filepath.Join(w.opts.Home, "state", GeneralWorkspaceName)
	// The write-ahead log travels with its database. Moving one without the other loses
	// every commit that had not been checkpointed and leaves megabytes behind.
	moves := []struct{ from, to string }{
		{filepath.Join(w.opts.Home, "session.sqlite"), filepath.Join(state, "session.sqlite")},
		{filepath.Join(w.opts.Home, "session.sqlite-wal"), filepath.Join(state, "session.sqlite-wal")},
		{filepath.Join(w.opts.Home, "session.sqlite-shm"), filepath.Join(state, "session.sqlite-shm")},
		{filepath.Join(w.opts.Home, "settings.json"), filepath.Join(state, "settings.json")},
	}
	for _, move := range moves {
		if _, err := os.Stat(move.from); err != nil {
			continue
		}
		if _, err := os.Stat(move.to); err == nil {
			continue
		}
		if err := os.MkdirAll(filepath.Dir(move.to), 0o700); err != nil {
			return err
		}
		if err := os.Rename(move.from, move.to); err != nil {
			return fmt.Errorf("moving %s into the general workspace: %w", move.from, err)
		}
		workerpool.Log("migrated %s to %s", move.from, move.to)
	}
	// A database that already moved leaves its sidecars behind: they belong to it, so
	// leaving them would both waste space and invite the next reader to use the wrong one.
	if _, err := os.Stat(filepath.Join(state, "session.sqlite")); err == nil {
		for _, orphan := range []string{"session.sqlite-wal", "session.sqlite-shm"} {
			path := filepath.Join(w.opts.Home, orphan)
			if _, err := os.Stat(path); err == nil {
				workerpool.Log("removing orphaned %s", path)
				_ = os.Remove(path)
			}
		}
	}
	return nil
}
