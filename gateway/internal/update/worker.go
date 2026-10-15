// Worker runtime ensure: a pinned bun plus the worker sources, both under
// the install folder. Releases ship the sources as one tarball; the gateway
// downloads bun once and installs dependencies when the lockfile changes.
// Nothing lands on the host PATH and nothing outside the install folder.
// A missing toolchain is a loud refusal, never a boot failure and never a
// silent fallback.
package update

import (
	"archive/tar"
	"archive/zip"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strings"
	"time"
)

// BunVersion is the one bun the gateway runs workers with. Upgrading it is
// a code change with a test run, not a float: a new runtime under old
// sources is how installs break differently per machine.
const BunVersion = "1.4.2"

// WorkerTarball is the release asset holding the worker sources:
// package.json, bun.lock, and src/, with the top directory stripped.
const WorkerTarball = "worker.tar.gz"

// bunDownloadBase is where bun releases live. A test points elsewhere.
const bunDownloadBase = "https://github.com/oven-sh/bun/releases/download"

func (m *Manager) toolsDir() string   { return filepath.Join(m.home, "tools") }
func (m *Manager) bunDir() string     { return filepath.Join(m.toolsDir(), "bun-"+BunVersion) }
func (m *Manager) workerDir() string  { return filepath.Join(m.home, "worker") }
func (m *Manager) workerBak() string  { return m.workerDir() + ".bak" }
func (m *Manager) workerBad() string  { return m.workerDir() + ".bad" }
func (m *Manager) workerTag() string  { return filepath.Join(m.workerDir(), "VERSION") }
func (m *Manager) workerLock() string { return filepath.Join(m.workerDir(), "bun.lock") }
func (m *Manager) workerMark() string {
	return filepath.Join(m.workerDir(), "node_modules", ".acornfall-installed")
}
func (m *Manager) workerPending() string { return filepath.Join(m.home, "worker.pending.tgz") }

// BunPath is where the pinned bun lives. It may not exist yet: EnsureBun
// downloads it, and a missing one with no network is a refusal, not a guess.
func (m *Manager) BunPath() string { return filepath.Join(m.bunDir(), "bun") }

// BunInstalled reports whether the pinned runtime answers, and where.
// Exported for doctor: diagnosis reads, never installs.
func (m *Manager) BunInstalled() (string, bool) { return m.bunReady() }

// WorkerDir is where the ensured worker sources live.
func (m *Manager) WorkerDir() string { return m.workerDir() }

// WorkerVersion reports the ensured sources' tag, or "" when none.
func (m *Manager) WorkerVersion() string {
	payload, err := os.ReadFile(m.workerTag())
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(payload))
}

func (m *Manager) bunBase() string {
	if m.bunBaseURL != "" {
		return m.bunBaseURL
	}
	return bunDownloadBase
}

// EnsureBun makes the pinned bun exist and answer its version. Downloading
// it is the only network this path does; without it the worker refuses
// loudly at workspace open.
func (m *Manager) EnsureBun(ctx context.Context) (string, error) {
	if path, ok := m.bunReady(); ok {
		return path, nil
	}
	if err := m.downloadBun(ctx); err != nil {
		return "", err
	}
	if path, ok := m.bunReady(); ok {
		return path, nil
	}
	return "", fmt.Errorf("update: bun %s downloaded but does not run", BunVersion)
}

func (m *Manager) bunReady() (string, bool) {
	path := m.BunPath()
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return "", false
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, path, "--version").Output()
	if err != nil {
		return "", false
	}
	if strings.TrimSpace(string(output)) != BunVersion {
		return "", false
	}
	return path, true
}

func bunPlatform() (string, error) {
	arch := map[string]string{"amd64": "x64", "arm64": "aarch64"}[runtime.GOARCH]
	if arch == "" {
		return "", fmt.Errorf("update: no bun release for %s/%s", runtime.GOOS, runtime.GOARCH)
	}
	if runtime.GOOS != "linux" && runtime.GOOS != "darwin" {
		return "", fmt.Errorf("update: no bun release for %s/%s", runtime.GOOS, runtime.GOARCH)
	}
	return fmt.Sprintf("bun-%s-%s", runtime.GOOS, arch), nil
}

func (m *Manager) downloadBun(ctx context.Context) error {
	platform, err := bunPlatform()
	if err != nil {
		return err
	}
	url := fmt.Sprintf("%s/bun-v%s/%s.zip", m.bunBase(), BunVersion, platform)
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return err
	}
	response, err := m.client.Do(request)
	if err != nil {
		return fmt.Errorf("update: cannot download bun %s: %w", BunVersion, err)
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		return fmt.Errorf("update: bun download answered %s", response.Status)
	}
	payload, err := io.ReadAll(io.LimitReader(response.Body, 256<<20))
	if err != nil {
		return err
	}
	binary, err := unzipBun(payload)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(m.bunDir(), 0o755); err != nil {
		return err
	}
	// Atomic like the binary swaps: a half-written runtime is worse than none.
	temp, err := os.CreateTemp(m.toolsDir(), ".bun-*")
	if err != nil {
		if err := os.MkdirAll(m.toolsDir(), 0o755); err != nil {
			return err
		}
		temp, err = os.CreateTemp(m.toolsDir(), ".bun-*")
		if err != nil {
			return err
		}
	}
	tempPath := temp.Name()
	defer func() { _ = os.Remove(tempPath) }()
	if _, err := temp.Write(binary); err != nil {
		_ = temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tempPath, 0o755); err != nil {
		return err
	}
	return os.Rename(tempPath, m.BunPath())
}

// unzipBun pulls the bun binary out of a release zip. The archive holds one
// top directory with the binary inside; anything else in it is ignored.
func unzipBun(payload []byte) ([]byte, error) {
	reader, err := zip.NewReader(bytes.NewReader(payload), int64(len(payload)))
	if err != nil {
		return nil, fmt.Errorf("update: bun zip unreadable: %w", err)
	}
	for _, file := range reader.File {
		if file.FileInfo().IsDir() || !strings.HasSuffix(file.Name, "/bun") {
			continue
		}
		opened, err := file.Open()
		if err != nil {
			return nil, err
		}
		binary, err := io.ReadAll(io.LimitReader(opened, 256<<20))
		_ = opened.Close()
		if err != nil {
			return nil, err
		}
		return binary, nil
	}
	return nil, fmt.Errorf("update: bun zip holds no binary")
}

// EnsureWorker makes the worker sources match tag: unpack the staged
// tarball when the live version differs, then install dependencies when
// the lockfile changed. A failure refuses loudly; it never fails boot —
// the caller logs it and serves everything else.
func (m *Manager) EnsureWorker(ctx context.Context, tag string) error {
	if tag == "" {
		return fmt.Errorf("update: no tag to ensure the worker for")
	}
	if m.WorkerVersion() != tag {
		// Updates stage the tarball; a fresh install has none, so boot
		// fetches it. Either way the network is needed once, and a
		// failure refuses loudly instead of bricking.
		if _, err := os.Stat(m.workerPending()); err != nil {
			if err := m.stageWorker(ctx, tag); err != nil {
				return err
			}
		}
		if err := m.activateWorker(tag); err != nil {
			return err
		}
	}
	return m.installWorker(ctx)
}

// RuntimeTag is the tag the running binary was built from: the stamp
// when present, else the version file. Execution must match the binary,
// not the record — a hand-swapped binary with a stale file still needs
// its own sources.
func (m *Manager) RuntimeTag() string {
	if BuildVersion != "" {
		return BuildVersion
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.current
}

// stageWorker downloads the release's worker tarball for tag, addressed
// directly: the wanted tag need not be latest. Only the matching tag is
// accepted: a tarball is that release's sources.
func (m *Manager) stageWorker(ctx context.Context, tag string) error {
	release, err := m.releaseFor(ctx, tag)
	if err != nil {
		return err
	}
	asset := WorkerTarballAsset(release)
	if asset.URL == "" {
		return fmt.Errorf("update: release %s has no %s", release.Tag, WorkerTarball)
	}
	tarball, err := m.download(ctx, asset)
	if err != nil {
		return err
	}
	list, err := m.checksumList(ctx, release)
	if err != nil {
		return err
	}
	if err := verify(list, tarball, release.Tag); err != nil {
		return err
	}
	return writeData(m.workerPending(), tarball)
}

// releaseFor fetches one release by tag, reusing the cached latest when
// it already answers. A missing tag names itself: typos fail plainly.
func (m *Manager) releaseFor(ctx context.Context, tag string) (Release, error) {
	m.mu.Lock()
	cached := m.latest
	m.mu.Unlock()
	if cached.Tag == tag {
		return cached, nil
	}
	url := m.apiBase() + "/releases/tags/" + tag
	response, err := m.get(ctx, url)
	if err != nil {
		return Release{}, err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		return Release{}, fmt.Errorf("releases: no release %s (%s): %w", tag, response.Status, ErrReleaseNotFound)
	}
	// Never cached: latest stays what the check found, or the dot lies.
	return parseRelease(response.Body)
}

// activateWorker rotates the staged tarball into place: live aside to
// .bak, unpack, stamp VERSION. Missing staged tarball is an error, not a
// fetch: boot must not depend on the network.
func (m *Manager) activateWorker(tag string) error {
	compressed, err := os.ReadFile(m.workerPending())
	if err != nil {
		return fmt.Errorf("update: no staged worker for %s: %w", tag, err)
	}
	gunzipped, err := gzip.NewReader(bytes.NewReader(compressed))
	if err != nil {
		return fmt.Errorf("update: staged worker unreadable: %w", err)
	}
	tarball, err := io.ReadAll(io.LimitReader(gunzipped, 64<<20))
	_ = gunzipped.Close()
	if err != nil {
		return fmt.Errorf("update: staged worker unreadable: %w", err)
	}
	if live, err := os.Stat(m.workerDir()); err == nil && live.IsDir() {
		_ = os.RemoveAll(m.workerBak())
		if err := os.Rename(m.workerDir(), m.workerBak()); err != nil {
			return fmt.Errorf("update: cannot move worker aside: %w", err)
		}
	}
	if err := os.MkdirAll(m.workerDir(), 0o755); err != nil {
		return err
	}
	if err := untarWorker(tarball, m.workerDir()); err != nil {
		return err
	}
	if err := os.WriteFile(m.workerTag(), []byte(tag+"\n"), 0o644); err != nil {
		return err
	}
	_ = os.Remove(m.workerPending())
	return nil
}

// rollbackWorker restores the worker sources moved aside by an update.
// No .bak means the update never moved them: nothing to do.
func (m *Manager) rollbackWorker() error {
	if _, err := os.Stat(m.workerBak()); err != nil {
		return nil
	}
	_ = os.RemoveAll(m.workerBad())
	if err := os.Rename(m.workerDir(), m.workerBad()); err != nil && !os.IsNotExist(err) {
		return fmt.Errorf("rollback: cannot move failed worker aside: %w", err)
	}
	if err := os.Rename(m.workerBak(), m.workerDir()); err != nil {
		return fmt.Errorf("rollback: cannot restore worker: %w", err)
	}
	return nil
}

// installWorker runs bun install when the lockfile changed since the last
// one. The marker carries the lock's hash; a match skips the network.
func (m *Manager) installWorker(ctx context.Context) error {
	lock, err := os.ReadFile(m.workerLock())
	if err != nil {
		return fmt.Errorf("update: worker has no bun.lock: %w", err)
	}
	sum := sha256.Sum256(lock)
	want := hex.EncodeToString(sum[:])
	if marker, err := os.ReadFile(m.workerMark()); err == nil && strings.TrimSpace(string(marker)) == want {
		return nil
	}
	bun, ok := m.bunReady()
	if !ok {
		return fmt.Errorf("update: bun %s is not installed; run with network once", BunVersion)
	}
	// Production only: type definitions and linters never run. Smaller,
	// faster, and the difference that fits a small disk.
	command := exec.CommandContext(ctx, bun, "install", "--frozen-lockfile", "--production")
	command.Dir = m.workerDir()
	output, err := command.CombinedOutput()
	if err != nil {
		return fmt.Errorf("update: bun install failed: %v: %s", err, strings.TrimSpace(string(output)))
	}
	if err := os.MkdirAll(filepath.Dir(m.workerMark()), 0o755); err != nil {
		return err
	}
	return os.WriteFile(m.workerMark(), []byte(want+"\n"), 0o644)
}

// untarWorker unpacks a sources tarball into dir. Paths stay inside: an
// absolute path, a parent escape, or a link is a refusal, not a surprise.
func untarWorker(tarball []byte, dir string) error {
	reader := tar.NewReader(bytes.NewReader(tarball))
	for {
		header, err := reader.Next()
		if err == io.EOF {
			return nil
		}
		if err != nil {
			return fmt.Errorf("update: worker tarball unreadable: %w", err)
		}
		if header.Typeflag != tar.TypeReg {
			continue
		}
		clean := filepath.Clean("/" + header.Name)
		target := filepath.Join(dir, clean)
		if !strings.HasPrefix(target, filepath.Clean(dir)+string(os.PathSeparator)) && target != filepath.Clean(dir) {
			return fmt.Errorf("update: worker tarball escapes: %q", header.Name)
		}
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			return err
		}
		out, err := os.OpenFile(target, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
		if err != nil {
			return err
		}
		_, err = io.Copy(out, io.LimitReader(reader, 64<<20))
		closeErr := out.Close()
		if err != nil {
			return err
		}
		if closeErr != nil {
			return closeErr
		}
	}
}
