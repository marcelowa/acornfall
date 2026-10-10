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
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
	"time"
)

// versionScript is a runnable stand-in for a staged binary: the exec gate
// runs it and it names its tag. Real binaries are proven in the drills.
func versionScript(tag string) string {
	return "#!/bin/sh\necho " + tag + "\n"
}

func releaseJSON(tag string, assets string) string {
	return fmt.Sprintf(`{"tag_name":%q,"name":%q,"body":"notes for %s","published_at":"2026-10-10T00:00:00Z","assets":[%s]}`,
		tag, tag, tag, assets)
}

func testManager(t *testing.T) (*Manager, string) {
	t.Helper()
	home := t.TempDir()
	bin := filepath.Join(t.TempDir(), "acornfall")
	if err := os.WriteFile(bin, []byte("old-binary"), 0o755); err != nil {
		t.Fatal(err)
	}
	migrate := t.TempDir()
	manager := New(home, bin, migrate)
	manager.client = &http.Client{}
	if err := manager.SetCurrentVersion("v0.8.0"); err != nil {
		t.Fatal(err)
	}
	return manager, home
}

func TestCheckFindsNewRelease(t *testing.T) {
	manager, _ := testManager(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(releaseJSON("v0.9.0", "")))
	}))
	defer server.Close()
	manager.latestURL = server.URL
	manager.client = server.Client()

	release, err := manager.Check(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if release.Tag != "v0.9.0" {
		t.Fatalf("got tag %q", release.Tag)
	}
	status := manager.Status()
	if !status.Available {
		t.Fatal("v0.9.0 over v0.8.0 should be available")
	}
	if status.Latest != "v0.9.0" || status.Notes != "notes for v0.9.0" {
		t.Fatalf("bad status %+v", status)
	}
}

func TestPinnedTagMeansNoPrompts(t *testing.T) {
	manager, _ := testManager(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(releaseJSON("v0.9.0", "")))
	}))
	defer server.Close()
	manager.latestURL = server.URL
	manager.client = server.Client()

	if err := manager.SaveSettings(Settings{Channel: "releases", AutoCheck: true, Pinned: "v0.8.0"}); err != nil {
		t.Fatal(err)
	}
	if _, err := manager.Check(context.Background()); err != nil {
		t.Fatal(err)
	}
	if status := manager.Status(); status.Available {
		t.Fatal("pinned installs must not prompt")
	}
}

func TestBuildVersionStampsFreshInstall(t *testing.T) {
	old := BuildVersion
	BuildVersion = "v0.9.0"
	defer func() { BuildVersion = old }()
	home := t.TempDir()
	bin := filepath.Join(t.TempDir(), "acornfall")
	if err := os.WriteFile(bin, []byte("x"), 0o755); err != nil {
		t.Fatal(err)
	}
	manager := New(home, bin, "")
	if err := manager.Open(); err != nil {
		t.Fatal(err)
	}
	// No version file: the stamp names the build, so it is not "dev".
	if status := manager.Status(); status.Current != "v0.9.0" {
		t.Fatalf("current = %q, want the stamp", status.Current)
	}
}

func TestDevBuildNeverPrompts(t *testing.T) {
	home := t.TempDir()
	bin := filepath.Join(t.TempDir(), "acornfall")
	if err := os.WriteFile(bin, []byte("x"), 0o755); err != nil {
		t.Fatal(err)
	}
	manager := New(home, bin, "")
	manager.client = &http.Client{}
	// No version file: current stays "dev".
	if err := manager.Open(); err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(releaseJSON("v0.9.0", "")))
	}))
	defer server.Close()
	manager.latestURL = server.URL
	manager.client = server.Client()
	if _, err := manager.Check(context.Background()); err != nil {
		t.Fatal(err)
	}
	if status := manager.Status(); status.Available {
		t.Fatal("a dev build cannot name itself, so it must not prompt")
	}
}

func TestBackupKeepsLastThree(t *testing.T) {
	manager, home := testManager(t)
	if err := os.WriteFile(filepath.Join(home, "workspaces.json"), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(home, "state", "general"), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(home, "state", "general", "session.sqlite"), []byte("db"), 0o600); err != nil {
		t.Fatal(err)
	}
	for range 5 {
		if _, err := manager.Backup(); err != nil {
			t.Fatal(err)
		}
	}
	backups := manager.Backups()
	if len(backups) != MaxBackups {
		t.Fatalf("got %d backups, want %d", len(backups), MaxBackups)
	}
}

func TestMigrateEmbeddedScriptRuns(t *testing.T) {
	manager, _ := testManager(t)
	manager.migrateDir = ""
	// v0.0.0-test.sh is baked into the binary: the embedded path runs it.
	// Underscore names do not embed, so the fixture wears a version tag.
	if err := manager.Migrate(context.Background(), "v0.0.0-test"); err != nil {
		t.Fatalf("embedded script should pass, got %v", err)
	}
}

func TestMigrateEmbeddedMissingIsNothingToDo(t *testing.T) {
	manager, _ := testManager(t)
	manager.migrateDir = ""
	if err := manager.Migrate(context.Background(), "vno-such-tag"); err != nil {
		t.Fatalf("missing embedded script should pass, got %v", err)
	}
}

// workerTar builds a gzipped sources tarball from name->body.
func workerTar(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var plain bytes.Buffer
	writer := tar.NewWriter(&plain)
	for name, body := range files {
		if err := writer.WriteHeader(&tar.Header{Name: name, Mode: 0o644, Size: int64(len(body))}); err != nil {
			t.Fatal(err)
		}
		if _, err := writer.Write([]byte(body)); err != nil {
			t.Fatal(err)
		}
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	var zipped bytes.Buffer
	zippedWriter := gzip.NewWriter(&zipped)
	if _, err := zippedWriter.Write(plain.Bytes()); err != nil {
		t.Fatal(err)
	}
	if err := zippedWriter.Close(); err != nil {
		t.Fatal(err)
	}
	return zipped.Bytes()
}

func workerFiles(tag string) map[string]string {
	return map[string]string{
		"package.json": "{\"name\":\"worker\"}\n",
		"bun.lock":     "lock-for-" + tag + "\n",
		"src/main.ts":  "// " + tag + "\n",
	}
}

func zipWriter(t *testing.T, out *bytes.Buffer) *zip.Writer {
	t.Helper()
	return zip.NewWriter(out)
}

func writeZipFile(t *testing.T, writer *zip.Writer, name, body string) {
	t.Helper()
	file, err := writer.Create(name)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.Write([]byte(body)); err != nil {
		t.Fatal(err)
	}
}

func TestApplyStagesWorkerTarball(t *testing.T) {
	manager, _ := testManager(t)
	tarball := workerTar(t, workerFiles("v0.9.0"))
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/worker.tgz" {
			_, _ = w.Write(tarball)
			return
		}
		_, _ = w.Write([]byte(versionScript("v0.9.0")))
	}))
	defer server.Close()
	manager.client = server.Client()
	manager.mu.Lock()
	manager.latest = Release{Tag: "v0.9.0", Assets: []Asset{
		{Name: "acornfall-" + runtime.GOOS + "-" + runtime.GOARCH, URL: server.URL + "/gw"},
		{Name: WorkerTarball, URL: server.URL + "/worker.tgz"},
	}}
	manager.mu.Unlock()
	if err := manager.Apply(context.Background(), ApplyOptions{Drain: "stop"}); err != nil {
		t.Fatal(err)
	}
	// Staged, not activated: the new gateway unpacks and installs at boot.
	staged, err := os.ReadFile(manager.workerPending())
	if err != nil || !bytes.Equal(staged, tarball) {
		t.Fatal("worker tarball must be staged byte-exact")
	}
	if _, err := os.Stat(manager.workerDir()); !os.IsNotExist(err) {
		t.Fatal("live sources must be untouched until boot")
	}
}

func TestApplySkipsWorkerWhenReleasePredatesIt(t *testing.T) {
	manager, _ := testManager(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(versionScript("v0.9.0")))
	}))
	defer server.Close()
	manager.client = server.Client()
	manager.mu.Lock()
	manager.latest = Release{Tag: "v0.9.0", Assets: []Asset{
		{Name: "acornfall-" + runtime.GOOS + "-" + runtime.GOARCH, URL: server.URL + "/gw"},
	}}
	manager.mu.Unlock()
	if err := manager.Apply(context.Background(), ApplyOptions{Drain: "stop"}); err != nil {
		t.Fatal(err)
	}
	// No worker asset: nothing staged, live sources untouched.
	if _, err := os.Stat(manager.workerPending()); !os.IsNotExist(err) {
		t.Fatal("no worker tarball, nothing to stage")
	}
}

func TestMigrateMissingScriptIsNothingToDo(t *testing.T) {
	manager, _ := testManager(t)
	if err := manager.Migrate(context.Background(), "v0.9.0"); err != nil {
		t.Fatalf("missing script should pass, got %v", err)
	}
}

func TestMigrateFailureStopsBoot(t *testing.T) {
	manager, _ := testManager(t)
	script := filepath.Join(manager.migrateDir, "v0.9.0.sh")
	if err := os.WriteFile(script, []byte("echo boom\nexit 1\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := manager.Migrate(context.Background(), "v0.9.0"); err == nil {
		t.Fatal("a failing script must stop boot")
	}
}

func TestApplyRefusesWhileRunsActive(t *testing.T) {
	manager, _ := testManager(t)
	manager.RunsActive = func() bool { return true }
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(releaseJSON("v0.9.0", "")))
	}))
	defer server.Close()
	manager.latestURL = server.URL
	manager.client = server.Client()

	if err := manager.Apply(context.Background(), ApplyOptions{Drain: "wait"}); err == nil {
		t.Fatal("active runs with drain=wait must refuse")
	} else if _, ok := err.(ErrRunsActive); !ok {
		t.Fatalf("want ErrRunsActive, got %T %v", err, err)
	}
}

func TestVerifyChecksChecksumFile(t *testing.T) {
	manager, _ := testManager(t)
	binary := []byte(versionScript("v0.9.0"))
	sum := sha256.Sum256(binary)
	good := hex.EncodeToString(sum[:]) + "  acornfall-bin\n"
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/x.bin":
			_, _ = w.Write(binary)
		case "/sums.txt":
			_, _ = w.Write([]byte(good))
		default:
			_, _ = w.Write([]byte(releaseJSON("v0.9.0", "")))
		}
	}))
	defer server.Close()
	manager.client = server.Client()
	manager.mu.Lock()
	manager.latest = Release{Tag: "v0.9.0", Assets: []Asset{
		{Name: "acornfall-" + runtime.GOOS + "-" + runtime.GOARCH, URL: server.URL + "/x.bin"},
		{Name: "sha256sums.txt", URL: server.URL + "/sums.txt"},
	}}
	manager.mu.Unlock()
	if err := manager.Apply(context.Background(), ApplyOptions{Drain: "stop"}); err != nil {
		t.Fatalf("matching checksum must pass, got %v", err)
	}
}

func TestVerifyRefusesMismatch(t *testing.T) {
	manager, _ := testManager(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/x.bin":
			_, _ = w.Write([]byte("evil-binary"))
		case "/sums.txt":
			_, _ = w.Write([]byte(strings.Repeat("0", 64) + "  acornfall-bin\n"))
		default:
			_, _ = w.Write([]byte(releaseJSON("v0.9.0", "")))
		}
	}))
	defer server.Close()
	manager.client = server.Client()
	manager.mu.Lock()
	manager.latest = Release{Tag: "v0.9.0", Assets: []Asset{
		{Name: "acornfall-" + runtime.GOOS + "-" + runtime.GOARCH, URL: server.URL + "/x.bin"},
		{Name: "sha256sums.txt", URL: server.URL + "/sums.txt"},
	}}
	manager.mu.Unlock()
	if err := manager.Apply(context.Background(), ApplyOptions{Drain: "stop"}); err == nil {
		t.Fatal("mismatched checksum must stop the update")
	} else if !strings.Contains(err.Error(), "checksum mismatch") {
		t.Fatalf("want checksum mismatch, got %v", err)
	}
	got, _ := os.ReadFile(manager.binPath)
	if string(got) != "old-binary" {
		t.Fatalf("failed verify must not touch the binary, got %q", got)
	}
}

func TestDownloadUsesAssetAPI(t *testing.T) {
	manager, _ := testManager(t)
	binary := []byte(versionScript("v0.9.0"))
	var gotAccept string
	mux := http.NewServeMux()
	mux.HandleFunc("/o/r/releases/latest", func(w http.ResponseWriter, r *http.Request) {
		name := "acornfall-" + runtime.GOOS + "-" + runtime.GOARCH
		assets := fmt.Sprintf(`{"id":7,"name":%q,"browser_download_url":%q,"size":10}`,
			name, "http://"+r.Host+"/o/r/download/x.bin")
		_, _ = w.Write([]byte(releaseJSON("v0.9.0", assets)))
	})
	mux.HandleFunc("/o/r/download/x.bin", func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "browser URLs 404 on private repos with a token", http.StatusNotFound)
	})
	mux.HandleFunc("/o/r/releases/assets/7", func(w http.ResponseWriter, r *http.Request) {
		gotAccept = r.Header.Get("Accept")
		_, _ = w.Write(binary)
	})
	server := httptest.NewServer(mux)
	defer server.Close()
	manager.latestURL = server.URL + "/o/r/releases/latest"
	manager.client = server.Client()
	if _, err := manager.Check(context.Background()); err != nil {
		t.Fatal(err)
	}
	if err := manager.Apply(context.Background(), ApplyOptions{Drain: "stop"}); err != nil {
		t.Fatal(err)
	}
	if gotAccept != "application/octet-stream" {
		t.Fatalf("asset API needs the octet accept, got %q", gotAccept)
	}
	got, _ := os.ReadFile(manager.binPath)
	if string(got) != versionScript("v0.9.0") {
		t.Fatalf("binary not swapped, got %q", got)
	}
}

func TestApplySwapsAndRollbackRestores(t *testing.T) {
	manager, _ := testManager(t)
	binary := []byte(versionScript("v0.9.0"))
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, ".bin") {
			_, _ = w.Write(binary)
			return
		}
		assets := fmt.Sprintf(`{"name":"acornfall-test-test","browser_download_url":%q,"size":10}`,
			"http://"+r.Host+"/x.bin")
		_, _ = w.Write([]byte(releaseJSON("v0.9.0", assets)))
	}))
	defer server.Close()
	// Point the platform-named asset at this test: AssetFor uses runtime
	// GOOS/GOARCH, so serve the release through a rewrite instead. The
	// manager downloads whatever AssetFor picks, so seed latest directly.
	manager.latestURL = server.URL
	manager.client = server.Client()
	release, err := manager.Check(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	_ = release
	// Seed a matching asset by hand: the test server names it per platform.
	manager.mu.Lock()
	manager.latest.Assets = []Asset{{Name: "acornfall-" + runtime.GOOS + "-" + runtime.GOARCH, URL: server.URL + "/x.bin", Size: 10}}
	manager.mu.Unlock()

	if err := manager.Apply(context.Background(), ApplyOptions{Drain: "stop"}); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(manager.binPath)
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != versionScript("v0.9.0") {
		t.Fatalf("binary not swapped, got %q", got)
	}
	if status := manager.Status(); !status.RestartRequired {
		t.Fatal("swapped files with an old process must ask for restart")
	}
	if tag, ok := manager.PendingMigrate(); !ok || tag != "v0.9.0" {
		t.Fatalf("pending migrate = %q, %v", tag, ok)
	}
	if err := manager.Rollback(fmt.Errorf("health never passed")); err != nil {
		t.Fatal(err)
	}
	got, _ = os.ReadFile(manager.binPath)
	if string(got) != "old-binary" {
		t.Fatalf("rollback did not restore, got %q", got)
	}
	if status := manager.Status(); status.Failed == "" {
		t.Fatal("the screen must show the rollback cause")
	}
}

// fakeBun installs a script answering --version and accepting install.
func fakeBun(t *testing.T, manager *Manager) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(manager.BunPath()), 0o755); err != nil {
		t.Fatal(err)
	}
	script := "#!/bin/sh\nif [ \"$1\" = \"--version\" ]; then echo " + BunVersion + "; fi\nexit 0\n"
	if err := os.WriteFile(manager.BunPath(), []byte(script), 0o755); err != nil {
		t.Fatal(err)
	}
}

func TestEnsureWorkerUnpacksAndStamps(t *testing.T) {
	manager, _ := testManager(t)
	fakeBun(t, manager)
	tarball := workerTar(t, workerFiles("v0.9.0"))
	if err := os.WriteFile(manager.workerPending(), tarball, 0o600); err != nil {
		t.Fatal(err)
	}
	live := manager.workerDir()
	if err := os.MkdirAll(live, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(live, "VERSION"), []byte("v0.8.0\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := manager.EnsureWorker(context.Background(), "v0.9.0"); err != nil {
		t.Fatal(err)
	}
	if got := manager.WorkerVersion(); got != "v0.9.0" {
		t.Fatalf("VERSION = %q", got)
	}
	main, err := os.ReadFile(filepath.Join(live, "src", "main.ts"))
	if err != nil || string(main) != "// v0.9.0\n" {
		t.Fatalf("sources not unpacked: %q, %v", main, err)
	}
	if _, err := os.Stat(live + ".bak"); err != nil {
		t.Fatal("old sources must be kept as .bak")
	}
	if _, err := os.Stat(manager.workerPending()); !os.IsNotExist(err) {
		t.Fatal("staged tarball must be consumed")
	}
}

func TestEnsureWorkerSkipsWhenCurrent(t *testing.T) {
	manager, _ := testManager(t)
	live := manager.workerDir()
	if err := os.MkdirAll(filepath.Join(live, "node_modules"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(live, "VERSION"), []byte("v0.9.0\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	lock := []byte("lock\n")
	if err := os.WriteFile(filepath.Join(live, "bun.lock"), lock, 0o644); err != nil {
		t.Fatal(err)
	}
	sum := sha256.Sum256(lock)
	if err := os.WriteFile(manager.workerMark(), []byte(hex.EncodeToString(sum[:])+"\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	// Lock matches the marker: unpack skipped, install skipped, no bun needed.
	if err := manager.EnsureWorker(context.Background(), "v0.9.0"); err != nil {
		t.Fatalf("current worker must pass untouched: %v", err)
	}
}

func TestRollbackRestoresWorkerSources(t *testing.T) {
	manager, _ := testManager(t)
	if err := os.WriteFile(manager.backupBinPath(), []byte("old-gateway"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(manager.workerDir(), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(manager.workerDir(), "src.ts"), []byte("new"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(manager.workerBak(), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(manager.workerBak(), "src.ts"), []byte("old"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := manager.Rollback(fmt.Errorf("boom")); err != nil {
		t.Fatal(err)
	}
	got, err := os.ReadFile(filepath.Join(manager.workerDir(), "src.ts"))
	if err != nil || string(got) != "old" {
		t.Fatalf("worker sources not restored: %q, %v", got, err)
	}
}

func TestUntarRefusesEscape(t *testing.T) {
	manager, _ := testManager(t)
	tarball := workerTar(t, map[string]string{"../evil.sh": "x\n", "package.json": "{}\n"})
	if err := untarWorker(tarball, manager.workerDir()); err == nil {
		t.Fatal("a tarball escaping the dir must refuse")
	}
}

func TestEnsureBunDownloads(t *testing.T) {
	manager, _ := testManager(t)
	var hits int
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		hits++
		var zipped bytes.Buffer
		writer := zipWriter(t, &zipped)
		writeZipFile(t, writer, "bun-linux-x64/bun", "#!/bin/sh\necho "+BunVersion+"\n")
		if err := writer.Close(); err != nil {
			t.Fatal(err)
		}
		_, _ = w.Write(zipped.Bytes())
	}))
	defer server.Close()
	manager.bunBaseURL = server.URL
	manager.client = server.Client()
	path, err := manager.EnsureBun(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path); err != nil {
		t.Fatalf("bun not installed: %v", err)
	}
	if _, err := manager.EnsureBun(context.Background()); err != nil {
		t.Fatal(err)
	}
	if hits != 1 {
		t.Fatalf("installed bun must be reused, downloads = %d", hits)
	}
}

func TestApplyRefusesWhileRestartPending(t *testing.T) {
	manager, _ := testManager(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(versionScript("v0.9.0")))
	}))
	defer server.Close()
	manager.client = server.Client()
	manager.mu.Lock()
	manager.latest = Release{Tag: "v0.9.0", Assets: []Asset{
		{Name: "acornfall-" + runtime.GOOS + "-" + runtime.GOARCH, URL: server.URL + "/gw"},
	}}
	manager.mu.Unlock()
	if err := manager.Apply(context.Background(), ApplyOptions{Drain: "stop"}); err != nil {
		t.Fatal(err)
	}
	if err := manager.Apply(context.Background(), ApplyOptions{Drain: "stop"}); err == nil {
		t.Fatal("a second apply before restart must refuse")
	} else if _, ok := err.(ErrRestartPending); !ok {
		t.Fatalf("want ErrRestartPending, got %T %v", err, err)
	}
}

func TestPreflightNamesRelease(t *testing.T) {
	manager, _ := testManager(t)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(releaseJSON("v0.9.0", "")))
	}))
	defer server.Close()
	manager.latestURL = server.URL
	manager.client = server.Client()
	preflight := manager.Preflight(context.Background())
	if preflight.Version != "v0.8.0" || preflight.Latest != "v0.9.0" {
		t.Fatalf("preflight = %+v", preflight)
	}
	if preflight.Worker == "" || preflight.Bun == "" || preflight.Releases == "" {
		t.Fatalf("preflight must name every piece: %+v", preflight)
	}
}

func TestPreflightDegradesOffline(t *testing.T) {
	manager, _ := testManager(t)
	manager.latestURL = "http://127.0.0.1:1/releases/latest"
	manager.client = &http.Client{Timeout: 2 * time.Second}
	preflight := manager.Preflight(context.Background())
	if preflight.Latest != "" {
		t.Fatal("offline must leave latest empty")
	}
	if !strings.Contains(preflight.Releases, "unreachable") {
		t.Fatalf("offline must say unreachable: %q", preflight.Releases)
	}
	if preflight.Version != "v0.8.0" {
		t.Fatal("local answers survive a dead network")
	}
}

func TestApplyStopsRunsOnDrainStop(t *testing.T) {
	manager, _ := testManager(t)
	manager.RunsActive = func() bool { return true }
	var stopped int
	manager.StopRuns = func(context.Context) error { stopped++; return nil }
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(versionScript("v0.9.0")))
	}))
	defer server.Close()
	manager.client = server.Client()
	manager.mu.Lock()
	manager.latest = Release{Tag: "v0.9.0", Assets: []Asset{
		{Name: "acornfall-" + runtime.GOOS + "-" + runtime.GOARCH, URL: server.URL + "/gw"},
	}}
	manager.mu.Unlock()
	if err := manager.Apply(context.Background(), ApplyOptions{Drain: "stop"}); err != nil {
		t.Fatal(err)
	}
	if stopped != 1 {
		t.Fatal("drain stop must stop runs before anything moves")
	}
}

func TestApplyNeedsStopperOnDrainStop(t *testing.T) {
	manager, _ := testManager(t)
	manager.RunsActive = func() bool { return true }
	if err := manager.Apply(context.Background(), ApplyOptions{Drain: "stop"}); err == nil {
		t.Fatal("active runs with no stopper must refuse")
	}
}

func TestApplyWipesSandboxesOnClean(t *testing.T) {
	manager, _ := testManager(t)
	var wiped []string
	manager.CleanVMs = func(ctx context.Context) error {
		wiped = append(wiped, "cleaned")
		return nil
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(versionScript("v0.9.0")))
	}))
	defer server.Close()
	manager.client = server.Client()
	manager.mu.Lock()
	manager.latest = Release{Tag: "v0.9.0", Assets: []Asset{
		{Name: "acornfall-" + runtime.GOOS + "-" + runtime.GOARCH, URL: server.URL + "/gw"},
	}}
	manager.mu.Unlock()
	if err := manager.Apply(context.Background(), ApplyOptions{CleanVMs: true, Drain: "stop"}); err != nil {
		t.Fatal(err)
	}
	if len(wiped) != 1 {
		t.Fatal("clean VMs must wipe")
	}
}

func TestApplyKeepsSandboxesByDefault(t *testing.T) {
	manager, _ := testManager(t)
	manager.CleanVMs = func(context.Context) error {
		t.Fatal("keep must not wipe")
		return nil
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte(versionScript("v0.9.0")))
	}))
	defer server.Close()
	manager.client = server.Client()
	manager.mu.Lock()
	manager.latest = Release{Tag: "v0.9.0", Assets: []Asset{
		{Name: "acornfall-" + runtime.GOOS + "-" + runtime.GOARCH, URL: server.URL + "/gw"},
	}}
	manager.mu.Unlock()
	if err := manager.Apply(context.Background(), ApplyOptions{Drain: "stop"}); err != nil {
		t.Fatal(err)
	}
}

func TestCleanSandboxesRemovesAndEmpties(t *testing.T) {
	state := t.TempDir()
	if err := os.MkdirAll(filepath.Join(state, "ws1"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(state, "img.bin"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	called := map[string]bool{}
	err := CleanSandboxes(context.Background(), []string{"a", "b"}, func(_ context.Context, name string) error {
		called[name] = true
		return nil
	}, state)
	if err != nil {
		t.Fatal(err)
	}
	if !called["a"] || !called["b"] {
		t.Fatal("every named sandbox must be removed through the engine")
	}
	if entries, _ := os.ReadDir(state); len(entries) != 0 {
		t.Fatal("state dir must be emptied, not deleted")
	}
}

func TestCleanSandboxesMissingStateIsClean(t *testing.T) {
	if err := CleanSandboxes(context.Background(), nil, nil, filepath.Join(t.TempDir(), "absent")); err != nil {
		t.Fatalf("missing state dir must pass: %v", err)
	}
}

func TestCheckExecRunsStagedBinary(t *testing.T) {
	script := filepath.Join(t.TempDir(), "fakebin")
	if err := os.WriteFile(script, []byte("#!/bin/sh\necho v0.9.0\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	payload, err := os.ReadFile(script)
	if err != nil {
		t.Fatal(err)
	}
	if err := checkExec(context.Background(), payload, "v0.9.0"); err != nil {
		t.Fatalf("runnable staged binary must pass: %v", err)
	}
	if err := checkExec(context.Background(), payload, "v9.9.9"); err == nil {
		t.Fatal("wrong tag must fail")
	}
	if err := checkExec(context.Background(), []byte("not-a-binary"), "v0.9.0"); err == nil {
		t.Fatal("garbage must fail")
	}
}
