// Package control's workspace layer: the install's registry of workspaces and one
// Control per started workspace.
//
// A Control owns one storage, and conversation ids are only unique inside a storage, so
// "which workspace" has to be answered before anything else can be looked up. That is what
// this file does: it routes, it starts workers lazily, and it keeps the registry.
// See docs/adr/0011-workspaces.md.
package control

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"github.com/acornfall/acornfall/gateway/internal/workerpool"
)

// GeneralWorkspaceName is where conversations land when nothing else is chosen. It exists
// in every install.
const GeneralWorkspaceName = "general"

// DefaultWorkspacesDir is where workspaces are created. It is deliberately outside the
// hidden installation folder: this is the reader's own content, and it should be somewhere
// they would look.
func DefaultWorkspacesDir() string {
	home, err := os.UserHomeDir()
	if err != nil {
		return "acornfall/workspaces"
	}
	return filepath.Join(home, "acornfall", "workspaces")
}

// Workspace is a folder the agent works in, plus the decisions that belong to it.
type Workspace struct {
	Name  string `json:"name"`
	Path  string `json:"path"`
	Title string `json:"title"`
	// General marks the default workspace. Exactly one workspace is general.
	General bool `json:"general"`
	// Trusted gates the workspace's own resources: its AGENTS.md, config, agents,
	// skills, and commands. An untrusted workspace is a folder and nothing else.
	Trusted bool `json:"trusted"`
	// Running is runtime state, never stored: a persisted `true` would be a claim about a
	// process that does not exist after a restart.
	Running bool `json:"-"`
}

// Views renders workspaces for the interface, which is the only place `running` belongs.
func Views(list []Workspace) []WorkspaceState {
	views := make([]WorkspaceState, 0, len(list))
	for _, workspace := range list {
		views = append(views, WorkspaceState{
			Name: workspace.Name, Path: workspace.Path, Title: workspace.Title,
			General: workspace.General, Trusted: workspace.Trusted, Running: workspace.Running,
		})
	}
	return views
}

// WorkspacesOptions configures the workspace layer.
type WorkspacesOptions struct {
	// Home is the installation folder: global resources, credentials, and state.
	Home string
	// GeneralPath is the general workspace's folder, from --workspace.
	GeneralPath string
	// WorkspacesDir is where workspaces are created, from --workspaces-dir. Empty means
	// the registry's value, and failing that the default.
	WorkspacesDir string
	WorkerCommand []string
	WorkerDir     string
	// Model is the install default, from --model.
	Model string
}

// Workspaces is the install: a registry of workspaces and their started Controls.
type Workspaces struct {
	opts WorkspacesOptions

	mu       sync.RWMutex
	dir      string
	registry map[string]Workspace
	controls map[string]*Control
	lastUsed map[string]time.Time
	starting map[string]*sync.Mutex
	closed   bool
}

func NewWorkspaces(opts WorkspacesOptions) *Workspaces {
	return &Workspaces{
		opts:     opts,
		registry: map[string]Workspace{},
		controls: map[string]*Control{},
		lastUsed: map[string]time.Time{},
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
		return err
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
func (w *Workspaces) Create(name string, trusted bool) (Workspace, error) {
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
	workspace := Workspace{Name: name, Path: path, Title: name, Trusted: trusted}
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
	// Trust and the folder are passed to the worker when it starts, so a change to either
	// only takes effect in a new process. Stopping it here is what makes the toggle mean
	// something immediately instead of at the next idle eviction.
	restart := control != nil && (existing.Trusted != workspace.Trusted || existing.Path != workspace.Path)
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
	if _, exists := w.registry[name]; !exists {
		w.mu.Unlock()
		return fmt.Errorf("no workspace %q", name)
	}
	control := w.controls[name]
	delete(w.registry, name)
	delete(w.controls, name)
	delete(w.lastUsed, name)
	w.mu.Unlock()
	if control != nil {
		control.Close()
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
		w.touch(name)
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
		w.touch(name)
		return control, nil
	}

	control = New(Options{
		Workspace:     workspace,
		Credentials:   filepath.Join(w.opts.Home, "credentials.json"),
		Registry:      w.List,
		WorkspacesDir: w.Dir(),
		Home:          w.opts.Home,
		StoragePath:   filepath.Join(w.opts.Home, "state", name, "session.sqlite"),
		SettingsPath:  filepath.Join(w.opts.Home, "state", name, "settings.json"),
		WorkerCommand: w.opts.WorkerCommand,
		WorkerDir:     w.opts.WorkerDir,
		Model:         w.opts.Model,
	})
	if err := os.MkdirAll(filepath.Join(w.opts.Home, "state", name), 0o700); err != nil {
		return nil, err
	}
	if err := control.Open(ctx); err != nil {
		return nil, fmt.Errorf("workspace %q: %w", name, err)
	}
	w.mu.Lock()
	w.controls[name] = control
	w.lastUsed[name] = time.Now()
	w.mu.Unlock()
	workerpool.Log("workspace %s started (%s)", name, workspace.Path)
	return control, nil
}

// Route finds the workspace a conversation belongs to. Names are checked first so that a
// caller holding one does not pay for a lookup it already knows the answer to.
func (w *Workspaces) Route(ctx context.Context, workspaceName, conversationID string) (Workspace, *Control, error) {
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

func (w *Workspaces) touch(name string) {
	w.mu.Lock()
	w.lastUsed[name] = time.Now()
	w.mu.Unlock()
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
			w.mu.Lock()
			var stopping []*Control
			for name, control := range w.controls {
				if name == GeneralWorkspaceName {
					continue
				}
				if time.Since(w.lastUsed[name]) < idleEviction {
					continue
				}
				if control.Watching() || control.Busy() {
					continue
				}
				stopping = append(stopping, control)
				delete(w.controls, name)
			}
			w.mu.Unlock()
			for _, control := range stopping {
				control.Close()
			}
			if len(stopping) > 0 {
				workerpool.Log("stopped %d idle workspace(s)", len(stopping))
			}
		}
	}
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
	Path          string      `json:"-"`
	WorkspacesDir string      `json:"workspacesDir,omitempty"`
	Workspaces    []Workspace `json:"workspaces"`
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
		dir = DefaultWorkspacesDir()
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
			Name:  GeneralWorkspaceName,
			Path:  absolute,
			Title: filepath.Base(absolute),
			// The folder the install was started in is the reader's own; anything else is
			// a folder they pointed at, and gets no resources until they say so.
			General: true,
			Trusted: true,
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
