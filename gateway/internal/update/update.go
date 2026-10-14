// Package update is the self-update tier: version file, release check,
// backup set, migrate runner, health-gated switch, rollback.
//
// v1 reads GitHub releases only. The gateway checks once per hour and on
// demand; the update screen shows one dot, one screen, one click. A failed
// update returns to the last good build. See docs/adr/0019-self-update.md.
package update

import (
	"context"
	"crypto/sha256"
	"embed"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"
)

// LatestURL is the v1 release source: GitHub releases only.
const LatestURL = "https://api.github.com/repos/marcelowa/acornfall/releases/latest"

// CheckInterval is how often the gateway checks on its own.
const CheckInterval = time.Hour

// MaxBackups is how many backup sets are kept.
const MaxBackups = 3

// migrateFS is the release migrate scripts, baked into the binary: an
// update never depends on a checkout being beside it. --migrate-dir
// overrides it for script authors.
//
//go:embed migrate
var migrateFS embed.FS

// BuildVersion is the release tag stamped at build time. A fresh install
// from a release therefore knows its tag without a version file. The file
// wins when both exist: an update writes it, and what ran is what it says.
var BuildVersion string

// Release is one GitHub release, kept to the fields the screen reads.
type Release struct {
	Tag         string
	Name        string
	Notes       string
	PublishedAt string
	Assets      []Asset
}

// Asset is one release file. ID is the API asset id: downloads go through
// the asset API, not the browser URL, because browser URLs 404 on private
// repos with a Bearer token while the asset API answers with a signed redirect.
type Asset struct {
	ID   int64
	Name string
	URL  string
	Size int64
}

// Settings are the Updates tab: channel, auto-check, pinned tag.
// Pinned means no prompts.
type Settings struct {
	Channel   string `json:"channel"`
	AutoCheck bool   `json:"autoCheck"`
	Pinned    string `json:"pinned"`
}

// DefaultSettings is what a fresh install gets.
func DefaultSettings() Settings {
	return Settings{Channel: "releases", AutoCheck: true}
}

// Status is what GET /api/update/status answers.
type Status struct {
	Current  string `json:"current"`
	Latest   string `json:"latest"`
	Notes    string `json:"notes"`
	Pinned   string `json:"pinned"`
	Channel  string `json:"channel"`
	Checking bool   `json:"checking"`
	// Download sizes in bytes, for the screen's size line. Zero when the
	// release names no file for this platform.
	DownloadSize int64 `json:"downloadSize"`
	WorkerSize   int64 `json:"workerSize"`
	// Available is one dot, not a list: a newer tag exists and nothing pins it.
	Available bool `json:"available"`
	// Failed carries the last rollback cause, so the screen can say it.
	Failed string `json:"failed,omitempty"`
	// RestartRequired is set after files are swapped but the process is old.
	RestartRequired bool `json:"restartRequired,omitempty"`
}

// Preflight is doctor's update section: what runs, what the worker is,
// whether the toolchain is here, and whether releases answer. Missing
// pieces say "first boot fetches": an install is complete before its
// first run, and doctor must not demand a network to say the rest.
type Preflight struct {
	Version  string `json:"version"`
	Worker   string `json:"worker"`
	Bun      string `json:"bun"`
	Latest   string `json:"latest,omitempty"`
	Releases string `json:"releases"`
}

// Preflight builds the update section. The release check degrades to a
// sentence offline: everything local is still answered.
func (m *Manager) Preflight(ctx context.Context) Preflight {
	status := m.Status()
	preflight := Preflight{Version: status.Current}
	if worker := m.WorkerVersion(); worker != "" {
		preflight.Worker = worker
	} else if status.Current == "dev" {
		preflight.Worker = "dev (repo sources)"
	} else {
		preflight.Worker = "missing (first boot fetches)"
	}
	if path, ok := m.bunReady(); ok {
		preflight.Bun = BunVersion + " (" + path + ")"
	} else {
		preflight.Bun = "missing (first boot fetches)"
	}
	release, err := m.Check(ctx)
	if err != nil {
		preflight.Releases = releaseProblem(err)
	} else {
		preflight.Latest = release.Tag
		preflight.Releases = "reachable"
	}
	return preflight
}

func releaseProblem(err error) string {
	if os.Getenv("ACORNFALL_GITHUB_TOKEN") == "" && strings.Contains(err.Error(), "404") {
		return "not found: a private repo needs ACORNFALL_GITHUB_TOKEN, or no releases exist yet"
	}
	return "unreachable: " + err.Error()
}

// ApplyOptions are POST /api/update/apply.
type ApplyOptions struct {
	CleanVMs bool
	Drain    string
}

// ErrRunsActive is the refusal when runs are active and drain is "wait".
type ErrRunsActive struct{}

func (ErrRunsActive) Error() string {
	return "runs are active: wait for drain, stop runs and update, or cancel"
}

// ErrRestartPending is the refusal when files are swapped but the process
// is still the old build: restart first, update after.
type ErrRestartPending struct{}

func (ErrRestartPending) Error() string {
	return "restart pending: restart the gateway to finish the update, then update again"
}

// Manager owns the update state for one install.
type Manager struct {
	home       string
	binPath    string
	migrateDir string
	latestURL  string
	bunBaseURL string
	client     *http.Client

	mu       sync.Mutex
	settings Settings
	current  string
	latest   Release
	checking bool
	failed   string
	restart  bool

	// RunsActive reports whether any conversation is running. Injected so
	// tests need no control plane.
	RunsActive func() bool
	// StopRuns aborts every running conversation. Apply calls it when
	// drain is "stop": the dialog promises it, so the gateway does it.
	StopRuns func(ctx context.Context) error
	// CleanVMs wipes the sandbox tier for a Start-clean update. Injected
	// for the same reason as RunsActive.
	CleanVMs func(ctx context.Context) error
	// StopWorkers terminates worker processes without touching sandboxes.
	// Apply calls it before wiping (so no orphan resurrects the VMs) and
	// Restart calls it before exec (so no orphan serves old code).
	StopWorkers func()
	// IsAdmin decides POST /api/update/apply. Default allow: single user
	// now, admin later. Return false to get the 403 path today.
	IsAdmin func(r *http.Request) bool
}

// New builds a Manager. Empty binPath means the current executable.
// Empty migrateDir means <repo>/scripts/migrate beside nothing: pass it
// explicitly in production; empty disables the migrate step in tests.
func New(home, binPath, migrateDir string) *Manager {
	if binPath == "" {
		if executable, err := os.Executable(); err == nil {
			binPath = executable
		}
	}
	return &Manager{
		home:       home,
		binPath:    binPath,
		migrateDir: migrateDir,
		latestURL:  LatestURL,
		client:     &http.Client{Timeout: 30 * time.Second},
		settings:   DefaultSettings(),
		IsAdmin:    func(*http.Request) bool { return true },
	}
}

func (m *Manager) versionPath() string       { return filepath.Join(m.home, "version") }
func (m *Manager) settingsPath() string      { return filepath.Join(m.home, "update.json") }
func (m *Manager) backupsDir() string        { return filepath.Join(m.home, "backups") }
func (m *Manager) pendingPath() string       { return filepath.Join(m.home, "update.pending") }
func (m *Manager) failedPath() string        { return filepath.Join(m.home, "update.failed") }
func (m *Manager) backupBinPath() string     { return m.binPath + ".bak" }
func (m *Manager) backupVersionPath() string { return m.binPath + ".bak.version" }

// writeData publishes a data file (never executed): temp plus rename,
// so a reader never sees a half-written one.
func writeData(path string, payload []byte) error {
	temp, err := os.CreateTemp(filepath.Dir(path), ".data-*")
	if err != nil {
		return fmt.Errorf("update: cannot stage %s: %w", path, err)
	}
	tempPath := temp.Name()
	defer func() { _ = os.Remove(tempPath) }()
	if _, err := temp.Write(payload); err != nil {
		_ = temp.Close()
		return fmt.Errorf("update: cannot write %s: %w", path, err)
	}
	if err := temp.Close(); err != nil {
		return fmt.Errorf("update: cannot write %s: %w", path, err)
	}
	if err := os.Chmod(tempPath, 0o600); err != nil {
		return fmt.Errorf("update: cannot write %s: %w", path, err)
	}
	return os.Rename(tempPath, path)
}

// writeAtomic publishes payload at path through a temp file and a rename:
// a worker restarting mid-swap execs the old file or the new one, never a
// half-written one.
func writeAtomic(path string, payload []byte) error {
	temp, err := os.CreateTemp(filepath.Dir(path), ".new-*")
	if err != nil {
		return fmt.Errorf("update: cannot stage %s: %w", path, err)
	}
	tempPath := temp.Name()
	defer func() { _ = os.Remove(tempPath) }()
	if _, err := temp.Write(payload); err != nil {
		_ = temp.Close()
		return fmt.Errorf("update: cannot write %s: %w", path, err)
	}
	if err := temp.Close(); err != nil {
		return fmt.Errorf("update: cannot write %s: %w", path, err)
	}
	if err := os.Chmod(tempPath, 0o755); err != nil {
		return fmt.Errorf("update: cannot write %s: %w", path, err)
	}
	if err := os.Rename(tempPath, path); err != nil {
		return fmt.Errorf("update: cannot publish %s: %w", path, err)
	}
	return nil
}

// Open loads settings, version, and the last failure marker.
func (m *Manager) Open() error {
	if payload, err := os.ReadFile(m.settingsPath()); err == nil {
		var settings Settings
		if err := json.Unmarshal(payload, &settings); err == nil {
			if settings.Channel == "" {
				settings.Channel = "releases"
			}
			m.settings = settings
		}
	}
	if payload, err := os.ReadFile(m.versionPath()); err == nil {
		m.current = strings.TrimSpace(string(payload))
	}
	if m.current == "" {
		m.current = BuildVersion
	}
	if m.current == "" {
		m.current = "dev"
	}
	if payload, err := os.ReadFile(m.failedPath()); err == nil {
		m.failed = strings.TrimSpace(string(payload))
	}
	return nil
}

// SaveSettings writes the Updates tab.
func (m *Manager) SaveSettings(settings Settings) error {
	if settings.Channel == "" {
		settings.Channel = "releases"
	}
	m.mu.Lock()
	m.settings = settings
	m.mu.Unlock()
	payload, err := json.MarshalIndent(settings, "", "  ")
	if err != nil {
		return err
	}
	return os.WriteFile(m.settingsPath(), append(payload, '\n'), 0o600)
}

// Settings reads the Updates tab.
func (m *Manager) Settings() Settings {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.settings
}

// SetCurrentVersion records the running tag.
func (m *Manager) SetCurrentVersion(tag string) error {
	m.mu.Lock()
	m.current = tag
	m.mu.Unlock()
	return os.WriteFile(m.versionPath(), []byte(tag+"\n"), 0o644)
}

// Status builds the screen's answer.
func (m *Manager) Status() Status {
	m.mu.Lock()
	defer m.mu.Unlock()
	available := m.latest.Tag != "" && m.latest.Tag != m.current &&
		m.current != "dev" && m.settings.Pinned == ""
	// A dev build never knows its tag, so it never prompts: showing a dot
	// for a build that cannot name itself would be a lie.
	if m.current == "dev" {
		available = false
	}
	return Status{
		Current:         m.current,
		Latest:          m.latest.Tag,
		Notes:           m.latest.Notes,
		Pinned:          m.settings.Pinned,
		Channel:         m.settings.Channel,
		Checking:        m.checking,
		Available:       available,
		Failed:          m.failed,
		RestartRequired: m.restart,
		DownloadSize:    AssetFor(m.latest).Size,
		WorkerSize:      WorkerTarballAsset(m.latest).Size,
	}
}

// Check forces a release check now. Pinned tags still fetch (so the screen
// can name the release) but never prompt.
func (m *Manager) Check(ctx context.Context) (Release, error) {
	m.mu.Lock()
	m.checking = true
	m.mu.Unlock()
	defer func() {
		m.mu.Lock()
		m.checking = false
		m.mu.Unlock()
	}()
	release, err := m.fetch(ctx)
	if err != nil {
		return Release{}, err
	}
	m.mu.Lock()
	m.latest = release
	m.mu.Unlock()
	return release, nil
}

// StartLoop checks on demand plus once per hour when auto-check is on.
func (m *Manager) StartLoop(ctx context.Context) {
	ticker := time.NewTicker(CheckInterval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if m.Settings().AutoCheck {
				_, _ = m.Check(ctx)
			}
		}
	}
}

func (m *Manager) fetch(ctx context.Context) (Release, error) {
	url := m.latestURL
	if url == "" {
		url = LatestURL
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return Release{}, err
	}
	if token := os.Getenv("ACORNFALL_GITHUB_TOKEN"); token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	request.Header.Set("Accept", "application/vnd.github+json")
	response, err := m.client.Do(request)
	if err != nil {
		return Release{}, err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		return Release{}, fmt.Errorf("releases: github answered %s", response.Status)
	}
	return parseRelease(response.Body)
}

func parseRelease(body io.Reader) (Release, error) {
	var payload struct {
		TagName     string `json:"tag_name"`
		Name        string `json:"name"`
		Body        string `json:"body"`
		PublishedAt string `json:"published_at"`
		Assets      []struct {
			ID   int64  `json:"id"`
			Name string `json:"name"`
			URL  string `json:"browser_download_url"`
			Size int64  `json:"size"`
		} `json:"assets"`
	}
	if err := json.NewDecoder(body).Decode(&payload); err != nil {
		return Release{}, fmt.Errorf("releases: cannot read answer: %w", err)
	}
	if payload.TagName == "" {
		return Release{}, fmt.Errorf("releases: answer has no tag_name")
	}
	release := Release{
		Tag:         payload.TagName,
		Name:        payload.Name,
		Notes:       payload.Body,
		PublishedAt: payload.PublishedAt,
	}
	for _, asset := range payload.Assets {
		release.Assets = append(release.Assets, Asset{ID: asset.ID, Name: asset.Name, URL: asset.URL, Size: asset.Size})
	}
	return release, nil
}

// AssetFor picks the release file for this platform, or "" when the
// release publishes none. Names follow `acornfall-<goos>-<goarch>`.
func AssetFor(release Release) Asset {
	return assetNamed(release, "acornfall-"+runtime.GOOS+"-"+runtime.GOARCH)
}

// WorkerTarballAsset picks the worker sources tarball, or "" when the
// release predates it: then the worker step is skipped and the live
// sources keep running.
func WorkerTarballAsset(release Release) Asset {
	return assetNamed(release, WorkerTarball)
}

func assetNamed(release Release, name string) Asset {
	for _, asset := range release.Assets {
		if asset.Name == name {
			return asset
		}
	}
	return Asset{}
}

// Backup copies config, state DB, and workspace list into
// <home>/backups/<timestamp>/ and keeps the last 3. Secrets are never
// backed up: credentials.json stays out, and old copies are scrubbed.
// Update stops when backup fails.
func (m *Manager) Backup() (string, error) {
	stamp := time.Now().UTC().Format("20060102-150405.000000000")
	dir := filepath.Join(m.backupsDir(), stamp)
	// Same-nanosecond backups must not share a folder: rotation counts
	// folders, and two backups in one would silently be one.
	for i := 1; ; i++ {
		if _, err := os.Stat(dir); os.IsNotExist(err) {
			break
		}
		dir = filepath.Join(m.backupsDir(), fmt.Sprintf("%s-%d", stamp, i))
	}
	files := []string{"config.json", "settings.json", "workspaces.json", "version", "update.json"}
	for _, name := range files {
		source := filepath.Join(m.home, name)
		payload, err := os.ReadFile(source)
		if err != nil {
			continue
		}
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return "", err
		}
		if err := os.WriteFile(filepath.Join(dir, name), payload, 0o600); err != nil {
			return "", err
		}
	}
	if err := copyDir(filepath.Join(m.home, "state"), filepath.Join(dir, "state")); err != nil {
		return "", err
	}
	if err := m.pruneBackups(); err != nil {
		return "", err
	}
	m.scrubSecrets()
	return dir, nil
}

// Backups lists kept backup sets, newest last.
func (m *Manager) Backups() []string {
	entries, err := os.ReadDir(m.backupsDir())
	if err != nil {
		return nil
	}
	var names []string
	for _, entry := range entries {
		if entry.IsDir() {
			names = append(names, entry.Name())
		}
	}
	sort.Strings(names)
	return names
}

// scrubSecrets removes credentials.json from kept backup sets: old
// backups may hold secrets, new ones never do.
func (m *Manager) scrubSecrets() {
	for _, name := range m.Backups() {
		_ = os.Remove(filepath.Join(m.backupsDir(), name, "credentials.json"))
	}
}

func (m *Manager) pruneBackups() error {
	names := m.Backups()
	for len(names) > MaxBackups {
		oldest := filepath.Join(m.backupsDir(), names[0])
		if err := os.RemoveAll(oldest); err != nil {
			return err
		}
		names = names[1:]
	}
	return nil
}

func copyDir(source, target string) error {
	info, err := os.Stat(source)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if !info.IsDir() {
		return nil
	}
	entries, err := os.ReadDir(source)
	if err != nil {
		return err
	}
	if len(entries) == 0 {
		return nil
	}
	if err := os.MkdirAll(target, 0o700); err != nil {
		return err
	}
	for _, entry := range entries {
		from := filepath.Join(source, entry.Name())
		to := filepath.Join(target, entry.Name())
		if entry.IsDir() {
			if err := copyDir(from, to); err != nil {
				return err
			}
			continue
		}
		payload, err := os.ReadFile(from)
		if err != nil {
			return err
		}
		if err := os.WriteFile(to, payload, 0o600); err != nil {
			return err
		}
	}
	return nil
}

// Migrate runs the <tag>.sh release script: from --migrate-dir when set,
// else from the scripts baked into the binary. Missing script means
// nothing to do. Non-zero exit is the error the boot refuses on: boot
// stops and rollback starts. No silent fix-ups live anywhere else.
func (m *Manager) Migrate(ctx context.Context, tag string) error {
	if m.migrateDir != "" {
		script := filepath.Join(m.migrateDir, tag+".sh")
		if _, err := os.Stat(script); err != nil {
			if os.IsNotExist(err) {
				return nil
			}
			return err
		}
		return runScript(ctx, script, m.home, tag)
	}
	body, err := migrateFS.ReadFile("migrate/" + tag + ".sh")
	if err != nil {
		if errors.Is(err, fs.ErrNotExist) {
			return nil
		}
		return err
	}
	temp, err := os.CreateTemp("", "acornfall-migrate-*.sh")
	if err != nil {
		return err
	}
	tempPath := temp.Name()
	defer func() { _ = os.Remove(tempPath) }()
	if _, err := temp.Write(body); err != nil {
		_ = temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tempPath, 0o700); err != nil {
		return err
	}
	return runScript(ctx, tempPath, m.home, tag)
}

func runScript(ctx context.Context, script, home, tag string) error {
	command := exec.CommandContext(ctx, "sh", script, home)
	output, err := command.CombinedOutput()
	if err != nil {
		return fmt.Errorf("migrate %s: %v: %s", tag, err, strings.TrimSpace(string(output)))
	}
	return nil
}

// Apply backs up, downloads, verifies, swaps, and stages the migrate.
// It answers ErrRunsActive when runs are active and drain is not "stop".
// The process is still the old build when Apply returns: restart it, and
// the new binary migrates at boot before serving.
func (m *Manager) Apply(ctx context.Context, options ApplyOptions) error {
	if options.Drain == "" {
		options.Drain = "wait"
	}
	active := m.RunsActive != nil && m.RunsActive()
	if active && options.Drain != "stop" {
		return ErrRunsActive{}
	}
	m.mu.Lock()
	pending := m.restart
	m.mu.Unlock()
	// A second apply would move the new build aside as .bak and strand
	// the rollback: one update per restart.
	if pending {
		return ErrRestartPending{}
	}
	m.mu.Lock()
	release := m.latest
	m.mu.Unlock()
	if release.Tag == "" {
		fetched, err := m.Check(ctx)
		if err != nil {
			return err
		}
		release = fetched
	}
	asset := AssetFor(release)
	if asset.URL == "" {
		return fmt.Errorf("releases: no binary for %s/%s in %s", runtime.GOOS, runtime.GOARCH, release.Tag)
	}
	worker := WorkerTarballAsset(release)
	// Drain stop means it: runs end before anything else moves.
	if active {
		if m.StopRuns == nil {
			return fmt.Errorf("update: runs are active and nothing can stop them")
		}
		if err := m.StopRuns(ctx); err != nil {
			return fmt.Errorf("update: cannot stop runs: %w", err)
		}
	}
	if _, err := m.Backup(); err != nil {
		return fmt.Errorf("backup failed, update stopped: %w", err)
	}
	payload, err := m.download(ctx, asset)
	if err != nil {
		return err
	}
	// The worker tarball downloads and verifies before anything is staged:
	// a failure here leaves the gateway and the live sources untouched.
	// It stages, not activates: the new gateway unpacks and installs at
	// boot, when bun is ensured and failures refuse loudly instead of
	// bricking.
	list, err := m.checksumList(ctx, release)
	if err != nil {
		return err
	}
	if err := verify(list, payload, release.Tag); err != nil {
		return err
	}
	// The staged binary must execute and name its tag before it may
	// replace the running one: checksums prove intact, execution proves
	// runnable. A failure aborts with everything untouched.
	if err := checkExec(ctx, payload, release.Tag); err != nil {
		return err
	}
	if worker.URL != "" {
		tarball, err := m.download(ctx, worker)
		if err != nil {
			return err
		}
		if err := verify(list, tarball, release.Tag); err != nil {
			return err
		}
		if err := writeData(m.workerPending(), tarball); err != nil {
			return err
		}
	}
	// Start-clean wipes last, after everything verified: a failed download
	// must never cost the sandboxes. The screen warns that images and the
	// engine reinstall on next use.
	if options.CleanVMs {
		if m.CleanVMs == nil {
			return fmt.Errorf("update: clean VMs asked and nothing can wipe them")
		}
		if m.StopWorkers != nil {
			m.StopWorkers()
		}
		if err := m.CleanVMs(ctx); err != nil {
			return fmt.Errorf("update: cannot wipe sandboxes: %w", err)
		}
	}
	if err := m.swap(payload, release.Tag); err != nil {
		return err
	}
	return nil
}

// checkExec proves a staged binary runs and names its tag: `version` is
// pure Go with no flags, so this works on every platform the binary does.
// It runs from a temp copy under an empty home, never the live path: the
// version file would answer for the binary, and a failure must leave the
// running build and its backup exactly alone.
func checkExec(ctx context.Context, payload []byte, tag string) error {
	temp, err := os.CreateTemp("", "acornfall-check-*")
	if err != nil {
		return err
	}
	tempPath := temp.Name()
	defer func() { _ = os.Remove(tempPath) }()
	if _, err := temp.Write(payload); err != nil {
		_ = temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tempPath, 0o755); err != nil {
		return err
	}
	emptyHome, err := os.MkdirTemp("", "acornfall-check-home-*")
	if err != nil {
		return err
	}
	defer func() { _ = os.RemoveAll(emptyHome) }()
	ctx, cancel := context.WithTimeout(ctx, 60*time.Second)
	defer cancel()
	command := exec.CommandContext(ctx, tempPath, "version")
	command.Env = append(os.Environ(), "ACORNFALL_HOME="+emptyHome, "ACORNFALL_DATA="+emptyHome)
	output, err := command.Output()
	if err != nil {
		return fmt.Errorf("update: staged %s does not run: %w", tag, err)
	}
	if got := strings.TrimSpace(string(output)); got != tag {
		return fmt.Errorf("update: staged binary says %q, want %q", got, tag)
	}
	return nil
}

// CleanSandboxes removes every workspace sandbox through the engine and
// then empties the engine's state dir (images, snapshots). The engine
// install itself stays: reinstalling it is slow and never required by a
// format change. Names and remove come from the caller so tests need no
// engine; stateDir missing is clean already.
func CleanSandboxes(ctx context.Context, names []string, remove func(context.Context, string) error, stateDir string) error {
	for _, name := range names {
		if err := remove(ctx, name); err != nil {
			return fmt.Errorf("update: cannot remove sandbox %q: %w", name, err)
		}
	}
	entries, err := os.ReadDir(stateDir)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	for _, entry := range entries {
		if err := os.RemoveAll(filepath.Join(stateDir, entry.Name())); err != nil {
			return err
		}
	}
	return nil
}

// apiBase is scheme://host/repos/owner/repo, derived from the check URL.
const defaultAPIBase = "https://api.github.com/repos/marcelowa/acornfall"

func (m *Manager) apiBase() string {
	url := m.latestURL
	if url == "" {
		url = LatestURL
	}
	if before, _, ok := strings.Cut(url, "/releases/"); ok {
		return before
	}
	return defaultAPIBase
}

func (m *Manager) download(ctx context.Context, asset Asset) ([]byte, error) {
	url := asset.URL
	accept := ""
	if asset.ID != 0 {
		url = m.apiBase() + fmt.Sprintf("/releases/assets/%d", asset.ID)
		accept = "application/octet-stream"
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	if accept != "" {
		request.Header.Set("Accept", accept)
	}
	if token := os.Getenv("ACORNFALL_GITHUB_TOKEN"); token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response, err := m.client.Do(request)
	if err != nil {
		return nil, err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("releases: download answered %s", response.Status)
	}
	return io.ReadAll(io.LimitReader(response.Body, 256<<20))
}

// checksumList fetches the release's checksum file (sha256sums.txt or
// checksums.txt), or "" when the release publishes none. One fetch covers
// every file: the gateway and the worker are both checked against it.
// Without one it passes: the transport is TLS to github — see ADR 0019.
func (m *Manager) checksumList(ctx context.Context, release Release) (string, error) {
	var checksum Asset
	for _, asset := range release.Assets {
		if asset.Name == "sha256sums.txt" || asset.Name == "checksums.txt" {
			checksum = asset
			break
		}
	}
	if checksum.URL == "" {
		return "", nil
	}
	checksumURL := checksum.URL
	accept := ""
	if checksum.ID != 0 {
		checksumURL = m.apiBase() + fmt.Sprintf("/releases/assets/%d", checksum.ID)
		accept = "application/octet-stream"
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, checksumURL, nil)
	if err != nil {
		return "", err
	}
	if accept != "" {
		request.Header.Set("Accept", accept)
	}
	if token := os.Getenv("ACORNFALL_GITHUB_TOKEN"); token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response, err := m.client.Do(request)
	if err != nil {
		return "", fmt.Errorf("releases: cannot fetch checksums: %w", err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		return "", fmt.Errorf("releases: cannot fetch checksums: %s", response.Status)
	}
	list, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return "", err
	}
	return string(list), nil
}

// verify checks one payload against a fetched checksum list. An empty list
// passes: no checksum file, TLS only.
func verify(list string, payload []byte, tag string) error {
	if list == "" {
		return nil
	}
	return matchChecksum(payload, list, tag)
}

func matchChecksum(payload []byte, list, tag string) error {
	sum := sha256.Sum256(payload)
	want := hex.EncodeToString(sum[:])
	for line := range strings.SplitSeq(list, "\n") {
		fields := strings.Fields(line)
		if len(fields) >= 2 && fields[0] == want {
			return nil
		}
	}
	return fmt.Errorf("releases: checksum mismatch for %s", tag)
}

// swap keeps the last good binary as .bak, writes the new one, records the
// version, and stages the pending migrate. The swap renames rather than
// overwrites: a running binary cannot be overwritten (ETXTBSY) but it can
// be renamed aside — the process keeps its inode — and the new file takes
// its path. Linux and macOS allow this; Windows does not, and this product
// does not run there.
func (m *Manager) swap(payload []byte, tag string) error {
	if m.binPath == "" {
		return fmt.Errorf("update: no binary path")
	}
	if err := os.Rename(m.binPath, m.backupBinPath()); err != nil {
		return fmt.Errorf("update: cannot move running binary aside: %w", err)
	}
	if err := writeAtomic(m.binPath, payload); err != nil {
		// The new file failed: put the old one back, so the path still runs.
		_ = os.Rename(m.backupBinPath(), m.binPath)
		return err
	}
	m.mu.Lock()
	previous := m.current
	m.mu.Unlock()
	if err := os.WriteFile(m.backupVersionPath(), []byte(previous+"\n"), 0o644); err != nil {
		return err
	}
	if err := os.WriteFile(m.pendingPath(), []byte(tag+"\n"), 0o644); err != nil {
		return err
	}
	if err := m.SetCurrentVersion(tag); err != nil {
		return err
	}
	m.mu.Lock()
	m.restart = true
	m.failed = ""
	m.mu.Unlock()
	_ = os.Remove(m.failedPath())
	return nil
}

// Rollback restores the last good binary and version. The caller restarts.
// Rename-based like the swap: the failed binary may still be running, and a
// running binary cannot be overwritten, only moved aside.
func (m *Manager) Rollback(cause error) error {
	if m.binPath == "" {
		return fmt.Errorf("rollback: no binary path")
	}
	if _, err := os.Stat(m.backupBinPath()); err != nil {
		return fmt.Errorf("rollback: no backup binary: %w", err)
	}
	if err := os.Rename(m.binPath, m.binPath+".bad"); err != nil {
		return fmt.Errorf("rollback: cannot move failed binary aside: %w", err)
	}
	if err := os.Rename(m.backupBinPath(), m.binPath); err != nil {
		return fmt.Errorf("rollback: cannot restore backup: %w", err)
	}
	// The worker sources roll back with the gateway, and a staged tarball
	// from the failed update is dropped so boot does not activate it.
	_ = os.Remove(m.workerPending())
	if err := m.rollbackWorker(); err != nil {
		return err
	}
	previous := "unknown"
	if payload, err := os.ReadFile(m.backupVersionPath()); err == nil {
		previous = strings.TrimSpace(string(payload))
	}
	_ = m.SetCurrentVersion(previous)
	_ = os.Remove(m.pendingPath())
	message := "unknown cause"
	if cause != nil {
		message = cause.Error()
	}
	m.mu.Lock()
	m.failed = message
	m.restart = false
	m.mu.Unlock()
	_ = os.WriteFile(m.failedPath(), []byte(message+"\n"), 0o644)
	return nil
}

// Restart replaces the running process with the binary on disk: same
// args, same environment, new build. The caller just swapped it there.
// Only the apply path calls this, right after answering, so the client
// learns restartRequired and then the stream drops and reconnects on
// its own. A failure keeps the old process: the screen still says
// restartRequired and a human restarts instead.
func (m *Manager) Restart() error {
	// Workers die first: an orphan would keep serving old code past the
	// exec, and resurrect sandboxes a clean update just wiped.
	if m.StopWorkers != nil {
		m.StopWorkers()
	}
	bin, err := filepath.Abs(m.binPath)
	if err != nil {
		return err
	}
	return syscall.Exec(bin, os.Args, os.Environ())
}

// PendingMigrate reports the staged tag, if any.
func (m *Manager) PendingMigrate() (string, bool) {
	payload, err := os.ReadFile(m.pendingPath())
	if err != nil {
		return "", false
	}
	if tag := strings.TrimSpace(string(payload)); tag != "" {
		return tag, true
	}
	return "", false
}

// ClearPending drops the staged migrate after it passes.
func (m *Manager) ClearPending() {
	_ = os.Remove(m.pendingPath())
}

// RunPending runs the staged migrate at boot, before serving. A failing
// script restores the backup and reports the error: boot stops, rollback
// starts, the user never lands on a dead UI.
func (m *Manager) RunPending(ctx context.Context) error {
	tag, ok := m.PendingMigrate()
	if !ok {
		return nil
	}
	if err := m.Migrate(ctx, tag); err != nil {
		rollbackErr := m.Rollback(err)
		if rollbackErr != nil {
			return fmt.Errorf("migrate failed and rollback failed: %v (rollback: %v)", err, rollbackErr)
		}
		return fmt.Errorf("migrate failed, rolled back: %w", err)
	}
	m.ClearPending()
	return nil
}
