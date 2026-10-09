package sandbox

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestArtifactForNamesTheReleaseAssets(t *testing.T) {
	cases := map[[2]string]string{
		{"linux", "amd64"}:   "microsandbox-linux-x86_64.tar.gz",
		{"linux", "arm64"}:   "microsandbox-linux-aarch64.tar.gz",
		{"darwin", "arm64"}:  "microsandbox-darwin-aarch64.tar.gz",
		{"darwin", "amd64"}:  "microsandbox-darwin-x86_64.tar.gz",
		{"windows", "amd64"}: "",
		{"linux", "riscv64"}: "",
	}
	for platform, want := range cases {
		if got := ArtifactFor(platform[0], platform[1]); got != want {
			t.Errorf("ArtifactFor(%s, %s) = %q, want %q", platform[0], platform[1], got, want)
		}
	}
}

func TestTheEngineAndItsStateAreApartAndVersioned(t *testing.T) {
	driver := NewMicrosandbox("/home/me/.acornfall")
	if driver.InstallDir() == driver.StateDir() {
		t.Fatal("the engine directory is replaced on upgrade; the state must not live in it")
	}
	if !strings.Contains(driver.InstallDir(), Version) {
		t.Errorf("the engine directory should be versioned, got %s", driver.InstallDir())
	}
	if filepath.Dir(driver.binary()) != filepath.Join(driver.InstallDir(), "bin") {
		t.Errorf("the binary should live in the engine's bin, got %s", driver.binary())
	}
}

func TestInstallDownloadsVerifiesAndUnpacks(t *testing.T) {
	// The bundle is published flat: the binary, the guest kernel library, and files only
	// some entry points need.
	server := releaseServer(t, archive(t, map[string]string{
		"msb":                "#!/bin/sh\necho msb\n",
		"libkrunfw.so.5.6.1": "guest kernel\n",
		"agentd-aarch64":     "another platform\n",
	}))
	defer server.Close()

	driver := testDriver(t, server.URL, server.Client())
	if err := driver.Install(context.Background(), nil); err != nil {
		t.Fatal(err)
	}
	if !driver.Installed() {
		t.Fatalf("engine should be installed at %s", driver.binary())
	}
	// The loader is asked for the ABI name, so the chain from it to the file must exist.
	if err := resolves(filepath.Join(driver.InstallDir(), "lib", "libkrunfw.so"), "libkrunfw.so.5.6.1"); err != nil {
		t.Errorf("libkrunfw.so must lead to the library: %v", err)
	}
	if err := resolves(filepath.Join(driver.InstallDir(), "lib", "libkrunfw.so.5"), "libkrunfw.so.5.6.1"); err != nil {
		t.Errorf("libkrunfw.so.5 must lead to the library: %v", err)
	}
	if err := resolves(filepath.Join(driver.InstallDir(), "bin", "microsandbox"), "msb"); err != nil {
		t.Errorf("the SDK's entry point is the same program: %v", err)
	}
	if _, err := os.Stat(filepath.Join(driver.InstallDir(), "agentd-aarch64")); err == nil {
		t.Error("another platform's files should not be installed")
	}
	info, err := os.Stat(driver.binary())
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm()&0o111 == 0 {
		t.Errorf("the installed engine must be executable, got %v", info.Mode())
	}
	// A second install is the common case (every gateway start), and must not download.
	driver.base = server.URL + "-nowhere"
	if err := driver.Install(context.Background(), nil); err != nil {
		t.Errorf("an installed engine should be left as it is: %v", err)
	}
}

// The vulnerability this prevents: a checksum that does not match means the bytes are not
// the bytes the release published, and unpacking them would be trusting a stranger.
func TestInstallRefusesAMismatchedChecksum(t *testing.T) {
	server := releaseServerWithChecksum(t, bundle(t), strings.Repeat("0", 64))
	defer server.Close()

	err := testDriver(t, server.URL, server.Client()).Install(context.Background(), nil)
	if !errors.Is(err, ErrUnavailable) || !strings.Contains(err.Error(), "checksum mismatch") {
		t.Fatalf("want a checksum refusal, got %v", err)
	}
	if driver := testDriver(t, server.URL, server.Client()); driver.Installed() {
		t.Error("a failed install must leave nothing behind")
	}
}

// ... and a release that does not list our artifact is a refusal rather than a pass.
func TestInstallRefusesAnUnlistedArtifact(t *testing.T) {
	server := releaseServerWithChecksum(t, bundle(t), "")
	defer server.Close()

	err := testDriver(t, server.URL, server.Client()).Install(context.Background(), nil)
	if !errors.Is(err, ErrUnavailable) || !strings.Contains(err.Error(), "not in the release checksums") {
		t.Fatalf("want a missing-checksum refusal, got %v", err)
	}
}

// The archive is only as trustworthy as its checksum; both have to hold, so extraction must
// refuse members that would land outside the destination.
func TestUnpackRefusesAPathThatEscapes(t *testing.T) {
	payload := archive(t, map[string]string{"../escape": "owned\n"})
	if err := unpackVerified(bytes.NewReader(payload), "", t.TempDir()); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("want a refusal, got %v", err)
	}
}

func TestUnpackRefusesAnAbsolutePath(t *testing.T) {
	payload := archive(t, map[string]string{"/etc/passwd": "owned\n"})
	if err := unpackVerified(bytes.NewReader(payload), "", t.TempDir()); !errors.Is(err, ErrUnavailable) {
		t.Fatalf("want a refusal, got %v", err)
	}
}

func TestUnpackKeepsRelativeSymlinks(t *testing.T) {
	var buffer bytes.Buffer
	writer := gzip.NewWriter(&buffer)
	archiveWriter := tar.NewWriter(writer)
	body := "kernel\n"
	writeTar(t, archiveWriter, &tar.Header{Name: "lib/libkrunfw.so.1.2.3", Typeflag: tar.TypeReg, Mode: 0o644, Size: int64(len(body))}, body)
	writeTar(t, archiveWriter, &tar.Header{Name: "lib/libkrunfw.so.1", Typeflag: tar.TypeSymlink, Linkname: "libkrunfw.so.1.2.3", Mode: 0o777}, "")
	archiveWriter.Close()
	writer.Close()

	dest := t.TempDir()
	if err := unpackVerified(bytes.NewReader(buffer.Bytes()), "", dest); err != nil {
		t.Fatal(err)
	}
	target, err := os.Readlink(filepath.Join(dest, "lib", "libkrunfw.so.1"))
	if err != nil {
		t.Fatalf("the engine loads the library by the symlink's name: %v", err)
	}
	if target != "libkrunfw.so.1.2.3" {
		t.Errorf("symlink points at %q", target)
	}
}

func TestLoadNamesAnswerForBothPlatforms(t *testing.T) {
	linux := loadNames("libkrunfw.so.5.6.1")
	if linux["libkrunfw.so.5"] != "libkrunfw.so.5.6.1" || linux["libkrunfw.so"] != "libkrunfw.so.5" {
		t.Errorf("linux load names: %v", linux)
	}
	darwin := loadNames("libkrunfw.5.dylib")
	if darwin["libkrunfw.dylib"] != "libkrunfw.5.dylib" || len(darwin) != 1 {
		t.Errorf("darwin load names: %v", darwin)
	}
}

// The policy file is the engine's format, so it is the driver that owns it. A mount is full
// of colons and none of them need quoting; a folder called "a: b" does.
func TestRenderPinsTheWholePolicy(t *testing.T) {
	policy := Policy{Image: "golang:1.24", CPUs: 4, Memory: "4G", Egress: true, Workspace: "/home/me/work", IdleTimeout: "1h",
		Global: []string{"/home/me/.agents"}}
	got := string(policy.render(owner{uid: 1000, gid: 1000, mapFiles: true}))
	want := "" +
		"image: golang:1.24\n" +
		"cpus: 4\n" +
		"memory: 4G\n" +
		"idle_timeout: 1h\n" +
		"mounts:\n" +
		"  - /home/me/work:/home/me/work:uid=1000,gid=1000\n" +
		"  - /home/me/.agents:/home/me/.agents:ro\n"
	if got != want {
		t.Errorf("policy rendered as:\n%s\nwant:\n%s", got, want)
	}
}

// The resources are mounted read-only: the agent reads its instructions and runs their
// scripts, and a write into them from inside the sandbox is refused rather than quietly
// changing the instructions every future conversation will read.
func TestRenderMountsTheGlobalsReadOnly(t *testing.T) {
	policy := Policy{Workspace: "/w", Global: []string{"/home/me/.agents", "/home/me/.acornfall/config.json"}}
	got := string(policy.render(owner{mapFiles: false}))
	for _, want := range []string{
		"  - /home/me/.agents:/home/me/.agents:ro\n",
		"  - /home/me/.acornfall/config.json:/home/me/.acornfall/config.json:ro\n",
	} {
		if !strings.Contains(got, want) {
			t.Errorf("the global resource %q should be mounted read-only, got:\n%s", want, got)
		}
	}
	if strings.Contains(got, "/w:/w:ro") {
		t.Errorf("the workspace stays writable; read-only is for the resources, got:\n%s", got)
	}
}

// The engine's default network is an open one, so silence would mean yes. A workspace whose
// egress is off has to say so.
func TestRenderSaysNoToTheNetwork(t *testing.T) {
	if got := string(Policy{Workspace: "/w", Egress: false}.render(owner{})); !strings.Contains(got, "network: none\n") {
		t.Errorf("egress off should be explicit, got:\n%s", got)
	}
	if got := string(Policy{Workspace: "/w", Egress: true}.render(owner{})); strings.Contains(got, "network:") {
		t.Errorf("egress on should leave the engine's default alone, got:\n%s", got)
	}
}

func TestRenderDefaultsTheUnset(t *testing.T) {
	got := string(Policy{Workspace: "/w"}.render(owner{}))
	for _, want := range []string{"image: " + DefaultImage, "cpus: 2", "memory: 2G", "idle_timeout: 30m"} {
		if !strings.Contains(got, want+"\n") {
			t.Errorf("default %q missing from:\n%s", want, got)
		}
	}
}

func TestRenderQuotesAnAwkwardPath(t *testing.T) {
	got := string(Policy{Workspace: "/home/me/od d: name"}.render(owner{uid: 1, gid: 2, mapFiles: true}))
	if !strings.Contains(got, `"/home/me/od d: name:/home/me/od d: name:uid=1,gid=2"`) {
		t.Errorf("a path with a colon and a space has to be quoted, got:\n%s", got)
	}
}

// macOS shares files as the user already, and the ownership options are a Linux answer.
func TestRenderLeavesOwnershipAloneOffLinux(t *testing.T) {
	got := string(Policy{Workspace: "/Users/me/work"}.render(owner{mapFiles: false}))
	if strings.Contains(got, "uid=") {
		t.Errorf("ownership should not be invented where the platform maps it, got:\n%s", got)
	}
}

// The lifecycle is driven by the human-readable subcommands, which is the engine's contract.
func TestTheLifecycleCallsTheEngineAsDocumented(t *testing.T) {
	runner := &recorded{}
	driver := NewMicrosandbox(shortTempDir(t)).WithRunner(runner)
	driver.installed = true
	ctx := context.Background()
	if err := driver.Create(ctx, Policy{Workspace: "/home/me/work"}, t.TempDir()); err != nil {
		t.Fatal(err)
	}
	if err := driver.Start(ctx, "ws"); err != nil {
		t.Fatal(err)
	}
	if err := driver.Stop(ctx, "ws"); err != nil {
		t.Fatal(err)
	}
	if err := driver.Remove(ctx, "ws"); err != nil {
		t.Fatal(err)
	}
	want := [][]string{
		// What the engine can do is asked once, before it is told what to do: the answer
		// decides whether the create call carries `--nested-virt=false`.
		{"create", "--help"},
		{"create", "--conf"},
		{"start", "ws"},
		{"stop", "ws"},
		{"rm", "--force", "ws"},
	}
	if len(runner.calls) != len(want) {
		t.Fatalf("calls = %v", runner.calls)
	}
	for index, expected := range want {
		got := runner.calls[index]
		for position, field := range expected {
			if position >= len(got) || got[position] != field {
				t.Errorf("call %d = %v, want it to start with %v", index, got, expected)
			}
		}
	}
	// Removal must not depend on the sandbox being down first.
	if !strings.Contains(strings.Join(runner.calls[len(runner.calls)-1], " "), "--force") {
		t.Errorf("remove should force: %v", runner.calls)
	}
}

func TestThePolicyFileIsWrittenBesideTheWorkspaceState(t *testing.T) {
	dir := t.TempDir()
	driver := NewMicrosandbox(shortTempDir(t)).WithRunner(&recorded{})
	driver.installed = true
	if err := driver.Create(context.Background(), Policy{Workspace: "/home/me/work", Egress: true}, dir); err != nil {
		t.Fatal(err)
	}
	written, err := os.ReadFile(filepath.Join(dir, "sandbox.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(written), "image: "+DefaultImage) {
		t.Errorf("policy file should hold the policy, got:\n%s", written)
	}
}

// -- nesting -------------------------------------------------------------------------

// nestedHelp is the line a later engine advertises; the release this build pins has none.
const nestedHelp = "Options:\n      --nested-virt  Enable nested virtualization"

// helpRunner answers `create --help` with what the test says the engine publishes.
type helpRunner struct {
	recorded
	help string
}

func (r *helpRunner) Run(_ context.Context, args ...string) (string, error) {
	r.calls = append(r.calls, args)
	if len(args) == 2 && args[0] == "create" && args[1] == "--help" {
		return r.help, nil
	}
	return "", nil
}

// nestingDriver is a driver with an engine installed, told what the engine advertises and
// what the machine can grant — neither of which is this machine's business in a test.
func nestingDriver(t *testing.T, help string, host NestingSupport) (*Microsandbox, *helpRunner) {
	t.Helper()
	runner := &helpRunner{help: help}
	driver := NewMicrosandbox(shortTempDir(t)).WithRunner(runner)
	driver.installed = true
	driver.hostNested = func() NestingSupport { return host }
	return driver, runner
}

// createCall is the create invocation, skipping the question about nesting.
func createCall(t *testing.T, runner *helpRunner) []string {
	t.Helper()
	for _, call := range runner.calls {
		if len(call) > 0 && call[0] == "create" && (len(call) < 2 || call[1] != "--help") {
			return call
		}
	}
	t.Fatalf("no create call among %v", runner.calls)
	return nil
}

func TestCreateAsksForNestingWhenAllowedAndPossible(t *testing.T) {
	driver, runner := nestingDriver(t, nestedHelp, NestingSupport{Available: true})
	policy := Policy{Workspace: "/home/me/work", AllowVMNesting: true}
	if err := driver.Create(context.Background(), policy, t.TempDir()); err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(strings.Join(createCall(t, runner), " "), "--nested-virt") {
		t.Errorf("a capable engine and machine should be asked for nesting: %v", runner.calls)
	}
}

func TestCreateLeavesNestingOffWhenTheWorkspaceDoesNotAllowIt(t *testing.T) {
	driver, runner := nestingDriver(t, nestedHelp, NestingSupport{Available: true})
	if err := driver.Create(context.Background(), Policy{Workspace: "/home/me/work"}, t.TempDir()); err != nil {
		t.Fatal(err)
	}
	// A refusal is said explicitly, so a default in the engine's own configuration cannot
	// turn nesting on under a workspace that chose against it.
	if !strings.Contains(strings.Join(createCall(t, runner), " "), "--nested-virt=false") {
		t.Errorf("a workspace that refuses nesting should say so: %v", runner.calls)
	}
}

func TestCreateSaysNothingAboutNestingToAnEngineThatCannot(t *testing.T) {
	driver, runner := nestingDriver(t, "Options:\n      --cpus", NestingSupport{Available: true})
	if err := driver.Create(context.Background(), Policy{Workspace: "/home/me/work"}, t.TempDir()); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(strings.Join(createCall(t, runner), " "), "--nested-virt") {
		t.Errorf("an engine without the flag has nothing to be told: %v", runner.calls)
	}
}

func TestCreateLeavesNestingOffWhenTheEngineCannot(t *testing.T) {
	driver, runner := nestingDriver(t, "Options:\n      --cpus", NestingSupport{Available: true})
	policy := Policy{Workspace: "/home/me/work", AllowVMNesting: true}
	if err := driver.Create(context.Background(), policy, t.TempDir()); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(strings.Join(createCall(t, runner), " "), "--nested-virt") {
		t.Errorf("an engine without the flag cannot nest and must not be told to: %v", runner.calls)
	}
}

func TestCreateLeavesNestingOffWhenTheMachineCannot(t *testing.T) {
	driver, runner := nestingDriver(t, nestedHelp, unavailable("the host kernel has nested virtualization off"))
	policy := Policy{Workspace: "/home/me/work", AllowVMNesting: true}
	if err := driver.Create(context.Background(), policy, t.TempDir()); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(strings.Join(createCall(t, runner), " "), "--nested-virt") {
		t.Errorf("a machine that cannot nest must not be asked to: %v", runner.calls)
	}
}

func TestNestingSaysWhichHalfRefused(t *testing.T) {
	engine, _ := nestingDriver(t, "Options:\n      --cpus", NestingSupport{Available: true})
	if support := engine.Nesting(context.Background()); support.Available || !strings.Contains(support.Reason, Version) {
		t.Errorf("an engine without the flag is the reason, and it names the version: %+v", support)
	}
	machine, _ := nestingDriver(t, nestedHelp, unavailable("this machine cannot nest"))
	if support := machine.Nesting(context.Background()); support.Available || support.Reason != "this machine cannot nest" {
		t.Errorf("the machine's own reason should come through: %+v", support)
	}
}

func TestNestingIsAskedOnceAndNotBeforeInstall(t *testing.T) {
	runner := &helpRunner{help: nestedHelp}
	driver := NewMicrosandbox(shortTempDir(t)).WithRunner(runner)
	driver.hostNested = func() NestingSupport { return NestingSupport{Available: true} }
	if support := driver.Nesting(context.Background()); support.Available || !strings.Contains(support.Reason, "not installed") {
		t.Fatalf("nesting before install = %+v", support)
	}
	if len(runner.calls) != 0 {
		t.Errorf("an engine that is not installed has nothing to ask: %v", runner.calls)
	}
	driver.installed = true
	for range 2 {
		if support := driver.Nesting(context.Background()); !support.Available {
			t.Fatalf("nesting when capable = %+v", support)
		}
	}
	asked := 0
	for _, call := range runner.calls {
		if strings.Join(call, " ") == "create --help" {
			asked++
		}
	}
	if asked != 1 {
		t.Errorf("the engine was asked %d times, want once", asked)
	}
}

// -- helpers -------------------------------------------------------------------------

// recorded stands in for the engine binary.
type recorded struct{ calls [][]string }

func (r *recorded) Run(_ context.Context, args ...string) (string, error) {
	r.calls = append(r.calls, args)
	if len(args) > 0 && args[0] == "list" {
		return "[]", nil
	}
	return "", nil
}

// shortTempDir is a home short enough for the engine's sockets, which is a real constraint
// (see statePathLimit) and a test's own long name is not.
func shortTempDir(t *testing.T) string {
	t.Helper()
	dir, err := os.MkdirTemp("", "af")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { os.RemoveAll(dir) })
	return dir
}

func testDriver(t *testing.T, base string, client *http.Client) *Microsandbox {
	t.Helper()
	driver := NewMicrosandbox(shortTempDir(t))
	driver.base = base
	driver.client = client
	return driver
}

// bundle is the shape the release publishes: flat, with the binary and the guest kernel.
func bundle(t *testing.T) []byte {
	t.Helper()
	return archive(t, map[string]string{"msb": "#!/bin/sh\n", "libkrunfw.so.5.6.1": "guest kernel\n"})
}

func archive(t *testing.T, files map[string]string) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := gzip.NewWriter(&buffer)
	archiveWriter := tar.NewWriter(writer)
	for name, body := range files {
		mode := int64(0o644)
		if name == "msb" {
			mode = 0o755
		}
		writeTar(t, archiveWriter, &tar.Header{Name: name, Typeflag: tar.TypeReg, Mode: mode, Size: int64(len(body))}, body)
	}
	if err := archiveWriter.Close(); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

func writeTar(t *testing.T, writer *tar.Writer, header *tar.Header, body string) {
	t.Helper()
	if err := writer.WriteHeader(header); err != nil {
		t.Fatal(err)
	}
	if body != "" {
		if _, err := writer.Write([]byte(body)); err != nil {
			t.Fatal(err)
		}
	}
}

func releaseServer(t *testing.T, payload []byte) *httptest.Server {
	t.Helper()
	sum := sha256.Sum256(payload)
	return releaseServerWithChecksum(t, payload, hex.EncodeToString(sum[:]))
}

func releaseServerWithChecksum(t *testing.T, payload []byte, sum string) *httptest.Server {
	t.Helper()
	artifact := ArtifactFor("linux", "amd64")
	if artifact == "" {
		t.Skip("this test needs a platform the release publishes")
	}
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch {
		case strings.HasSuffix(r.URL.Path, "/checksums.sha256"):
			if sum == "" {
				fmt.Fprint(w, "aaaa  something-else.tar.gz\n")
				return
			}
			fmt.Fprintf(w, "%s  %s\n", sum, artifact)
		case strings.HasSuffix(r.URL.Path, "/"+artifact):
			w.Write(payload)
		default:
			http.NotFound(w, r)
		}
	}))
}

// resolves follows a symlink chain to its target's base name.
func resolves(path, want string) error {
	for range 4 {
		target, err := os.Readlink(path)
		if err != nil {
			return err
		}
		if filepath.Base(target) == want {
			return nil
		}
		path = filepath.Join(filepath.Dir(path), target)
	}
	return fmt.Errorf("%s does not lead to %s", path, want)
}
