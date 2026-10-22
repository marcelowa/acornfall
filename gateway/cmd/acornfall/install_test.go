package main

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/acornfall/acornfall/gateway/internal/control"
	"github.com/acornfall/acornfall/gateway/internal/update"
)

// fakeInit is the service manager, as a test needs it: a unit path and its content, and flags for the verbs
// that start, stop and linger it.
type fakeInit struct {
	unitPath     string
	active       bool
	enabled      bool
	restarts     int
	linger       bool
	enableCalls  int
	disableCalls int
	lingerOff    int
	order        *[]string
}

func (f *fakeInit) Name() string { return "fake" }

func (f *fakeInit) Unit(cfg unitConfig) (string, string, error) {
	_, content, err := unitFor("linux", cfg)
	return f.unitPath, content, err
}

func (f *fakeInit) Reload(context.Context) error { return nil }

func (f *fakeInit) Enable(context.Context) error {
	f.enableCalls++
	f.active = true
	if f.order != nil {
		*f.order = append(*f.order, "enable")
	}
	return nil
}

func (f *fakeInit) Disable(context.Context) error {
	f.disableCalls++
	f.active = false
	if f.order != nil {
		*f.order = append(*f.order, "disable")
	}
	return nil
}

func (f *fakeInit) Active(context.Context) bool { return f.active }

func (f *fakeInit) Enabled(context.Context) (bool, error) { return f.enabled, nil }

func (f *fakeInit) Restart(context.Context) error {
	f.restarts++
	f.active = true
	return nil
}

func (f *fakeInit) Linger(context.Context) (bool, error) { return f.linger, nil }

func (f *fakeInit) EnableLinger(context.Context) error { f.linger = true; return nil }

func (f *fakeInit) DisableLinger(context.Context) error {
	f.lingerOff++
	f.linger = false
	return nil
}

// installFixture is an install that has not happened yet: two temp folders, a fake service manager whose unit
// lives in the user's temp home, and the running binary's bytes.
type installFixture struct {
	install installer
	init    *fakeInit
	say     *[]string
}

func newInstallFixture(t *testing.T, declaration update.Declaration) installFixture {
	t.Helper()
	// An install that recreates a machine unpacks the release's artifact: the fetch is stubbed with a real
	// tarball, so the disk it makes is a disk.
	original := fetchApplianceTarball
	t.Cleanup(func() { fetchApplianceTarball = original })
	fetchApplianceTarball = func(context.Context, string, string, bool) (string, error) {
		return applianceTarball(t), nil
	}
	userHome := t.TempDir()
	home := filepath.Join(userHome, ".acornfall")
	root := filepath.Join(userHome, "acornfall")
	init := &fakeInit{unitPath: filepath.Join(userHome, ".config", "systemd", "user", "acornfall-machine.service"), enabled: true}
	said := &[]string{}
	return installFixture{
		init: init,
		say:  said,
		install: installer{
			userHome:    userHome,
			home:        home,
			root:        root,
			version:     "v0.10.0-beta.16",
			declaration: declaration,
			binary:      []byte("the running binary"),
			init:        init,
			kvm:         func() error { return nil },
		},
	}
}

func (f installFixture) run(t *testing.T) {
	t.Helper()
	if err := f.install.run(context.Background(), func(ok bool, sentence string) {
		state := "fixed"
		if ok {
			state = "ok"
		}
		*f.say = append(*f.say, state+" "+sentence)
	}); err != nil {
		t.Fatalf("install: %v", err)
	}
}

// An install is idempotent: the second run straight after the first finds everything right, writes nothing, and
// says so. That is what makes it a repair as well as an install.
func TestInstallTwiceChangesNothingTheSecondTime(t *testing.T) {
	declaration := update.Declaration{Wanted: update.IntentRunning, Host: "127.0.0.1", Port: 7777}
	fixture := newInstallFixture(t, declaration)
	fixture.run(t)
	afterFirst := len(*fixture.say)
	fixture.run(t)

	// The first run fixed what was missing; the second found all of it.
	second := (*fixture.say)[afterFirst:]
	for _, line := range second {
		if strings.HasPrefix(line, "fixed") {
			t.Errorf("the second install changed something: %q", line)
		}
	}
	// And the files it owns are the same bytes they were after the first run.
	versioned := update.VersionedBinary(fixture.install.home, fixture.install.version)
	if body, err := os.ReadFile(versioned); err != nil || string(body) != string(fixture.install.binary) {
		t.Fatalf("the binary at %s: %q, %v", versioned, body, err)
	}
}

// A unit with the wrong ExecStart is repaired, not reported: nobody edits a unit by hand, and the install is
// what makes it right again.
func TestInstallFixesAUnitWithTheWrongExecStart(t *testing.T) {
	fixture := newInstallFixture(t, update.Declaration{Wanted: update.IntentRunning, Host: "127.0.0.1", Port: 7777})
	if err := os.MkdirAll(filepath.Dir(fixture.init.unitPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(fixture.init.unitPath, []byte("ExecStart=/usr/local/bin/acornfall machine serve\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	fixture.run(t)
	body, err := os.ReadFile(fixture.init.unitPath)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(body), "ExecStart="+update.OwnedBinary(fixture.install.home)+" machine serve") {
		t.Errorf("the unit was not repaired:\n%s", body)
	}
	if strings.Contains(string(body), "/usr/local/bin") {
		t.Errorf("the wrong ExecStart is still there:\n%s", body)
	}
}

// A missing symlink is repaired: the unit starts the symlink, so an install that leaves it missing wrote a
// unit that cannot start.
func TestInstallFixesAMissingSymlink(t *testing.T) {
	fixture := newInstallFixture(t, update.Declaration{Wanted: update.IntentRunning})
	fixture.run(t)
	if err := os.Remove(update.OwnedBinary(fixture.install.home)); err != nil {
		t.Fatal(err)
	}
	fixture.run(t)
	target, err := os.Readlink(update.OwnedBinary(fixture.install.home))
	if err != nil {
		t.Fatalf("the symlink was not repaired: %v", err)
	}
	if target != update.VersionedBinary(fixture.install.home, fixture.install.version) {
		t.Errorf("the symlink points at %q", target)
	}
}

// Remote is the default answer, and there is no token: an install on a server is usually reached from another
// computer, and the console asks for nothing (MVP).
func TestRemoteIsTheDefaultAnswer(t *testing.T) {
	for _, c := range []struct {
		name     string
		remote   bool
		local    bool
		terminal bool
		want     bool
		refused  bool
	}{
		{name: "no flag and no terminal is remote", want: true},
		{name: "--remote", remote: true, want: true},
		{name: "--local", local: true, want: false},
		{name: "both is not an answer", remote: true, local: true, refused: true},
	} {
		t.Run(c.name, func(t *testing.T) {
			remote, err := remoteAnswer(c.remote, c.local, c.terminal)
			if c.refused {
				if err == nil {
					t.Fatal("--remote and --local together must be refused")
				}
				return
			}
			if err != nil {
				t.Fatal(err)
			}
			if remote != c.want {
				t.Errorf("remote = %v, want %v", remote, c.want)
			}
		})
	}
}

// The closing line is the address and one sentence about who can reach it. No token, because there is none.
func TestTheInstallPrintsTheAddressAndNoToken(t *testing.T) {
	remote := strings.Join(installClosing("0.0.0.0", 7777), "\n")
	if !strings.Contains(remote, "http://") || !strings.Contains(remote, ":7777") {
		t.Errorf("the address is not there:\n%s", remote)
	}
	if strings.Contains(remote, "token=") || strings.Contains(remote, "cookie") {
		t.Errorf("a remote install mentions a token:\n%s", remote)
	}
	if !strings.Contains(remote, "no token") {
		t.Errorf("nothing says the console asks for nothing:\n%s", remote)
	}
	local := strings.Join(installClosing("127.0.0.1", 7777), "\n")
	if !strings.Contains(local, "http://127.0.0.1:7777") || !strings.Contains(local, "loopback") {
		t.Errorf("a local install says it is loopback:\n%s", local)
	}
}

// Whichever answer an install gives, the unit and the declaration say the same address: the unit is generated
// from the declaration, so they cannot disagree.
func TestTheDeclarationAndTheUnitAgreeAfterEitherAnswer(t *testing.T) {
	for _, c := range []struct {
		name        string
		declaration update.Declaration
		wantHost    string
		wantPort    int
	}{
		{name: "local", declaration: update.Declaration{Wanted: update.IntentRunning, Host: "127.0.0.1", Port: 7777}, wantHost: "127.0.0.1", wantPort: 7777},
		{name: "remote", declaration: update.Declaration{Wanted: update.IntentRunning, Host: "0.0.0.0", Port: 8080}, wantHost: "0.0.0.0", wantPort: 8080},
	} {
		t.Run(c.name, func(t *testing.T) {
			fixture := newInstallFixture(t, c.declaration)
			fixture.run(t)
			body, err := os.ReadFile(fixture.init.unitPath)
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(string(body), "--host "+c.wantHost+" --port "+itoa(c.wantPort)) {
				t.Errorf("the unit does not carry the declaration's address:\n%s", body)
			}
			written := update.ReadDeclaration(fixture.install.root)
			host, port := written.Address()
			if host != c.wantHost || port != c.wantPort {
				t.Errorf("the declaration says %s:%d, want %s:%d", host, port, c.wantHost, c.wantPort)
			}
		})
	}
}

// `machine status` answers "where do I browse" without a browser, and from the declaration: the same address the
// unit starts the service with.
func TestStatusPrintsTheDeclaredAddress(t *testing.T) {
	root := t.TempDir()
	if err := update.WriteDeclaration(root, update.Declaration{Wanted: update.IntentRunning, Host: "0.0.0.0", Port: 9000}); err != nil {
		t.Fatal(err)
	}
	if got, want := statusAddress(root), "console: http://127.0.0.1:9000"; got != want {
		t.Errorf("status says %q, want %q", got, want)
	}
	empty := t.TempDir()
	if got, want := statusAddress(empty), "console: http://127.0.0.1:7777"; got != want {
		t.Errorf("a missing declaration says %q, want %q", got, want)
	}
}

// uninstallFixture is an install that happened: a unit, a binary, a machine with a disk, artifacts, and a mount
// with a person's work in it.
type uninstallFixture struct {
	remove      uninstaller
	machine     *fakeMachine
	init        *fakeInit
	order       *[]string
	workspace   string
	bookkeeping []string
}

func newUninstallFixture(t *testing.T) uninstallFixture {
	t.Helper()
	userHome := t.TempDir()
	home := filepath.Join(userHome, ".acornfall")
	root := filepath.Join(userHome, "acornfall")
	order := &[]string{}
	init := &fakeInit{unitPath: filepath.Join(userHome, ".config", "systemd", "user", "acornfall-machine.service"), order: order}
	machine := &fakeMachine{running: true, order: order}
	// The install: the unit, the binary, a disk, an artifact.
	for _, path := range []string{init.unitPath, update.VersionedBinary(home, "v0.10.0-beta.16"), update.VersionedBinary(home, "v0.10.0-beta.15")} {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("x"), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := os.Symlink(update.VersionedBinary(home, "v0.10.0-beta.16"), update.OwnedBinary(home)); err != nil {
		t.Fatal(err)
	}
	writeApplianceFiles(t, applianceDisk(home), "")
	if err := os.MkdirAll(filepath.Join(home, "appliance"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(home, "appliance", "v0.10.0-beta.16.tar.gz"), []byte("artifact"), 0o644); err != nil {
		t.Fatal(err)
	}
	// The person's work, and our bookkeeping around it.
	workspace := filepath.Join(root, "workspaces", "general", "notes.md")
	if err := os.MkdirAll(filepath.Dir(workspace), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(workspace, []byte("a person's work"), 0o644); err != nil {
		t.Fatal(err)
	}
	// A conversation and the registry are the person's too, and they live under state/ beside our bookkeeping.
	conversation := filepath.Join(root, "state", "conversations", "a-conversation.json")
	if err := os.MkdirAll(filepath.Dir(conversation), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(conversation, []byte(`{"a conversation":"that is the person's"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	bookkeeping := []string{
		update.MachineIntentPath(root),
		update.IsPath(root),
		filepath.Join(update.HostDir(root), "update.lock"),
		update.BootAttemptPath(root),
		filepath.Join(root, "config", "token"),
	}
	for _, path := range bookkeeping {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("ours"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	return uninstallFixture{
		order:       order,
		machine:     machine,
		init:        init,
		workspace:   workspace,
		bookkeeping: bookkeeping,
		remove: uninstaller{
			userHome: userHome,
			home:     home,
			root:     root,
			init:     init,
			machine:  machine,
			say:      func(string, string) {},
		},
	}
}

// Uninstall stops the service before it takes the machine away, and never takes a running machine's disk: the
// order is the whole of what makes it safe.
func TestUninstallStopsARunningMachineFirst(t *testing.T) {
	fixture := newUninstallFixture(t)
	fixture.machine.removeErr = errors.New("the engine cannot remove the machine")
	if err := fixture.remove.run(context.Background()); err == nil {
		t.Fatal("a machine that cannot be removed must stop the uninstall")
	}
	if fixture.init.disableCalls != 1 {
		t.Errorf("the service was disabled %d times", fixture.init.disableCalls)
	}
	if _, err := os.Stat(applianceDisk(fixture.remove.home)); err != nil {
		t.Errorf("the disk of a running machine was removed: %v", err)
	}
	// And with the machine removable, the service is disabled before the machine goes.
	fixture.machine.removeErr = nil
	*fixture.order = nil
	if err := fixture.remove.run(context.Background()); err != nil {
		t.Fatal(err)
	}
	// The service stops before the machine, and the machine before the disk it was running on: the disk is
	// removed after the "machine" entry, which is the one thing this order is for.
	if got, want := strings.Join(*fixture.order, ","), "disable,machine"; got != want {
		t.Errorf("the order was %q, want %q", got, want)
	}
}

// Uninstall removes our bookkeeping inside the mount and keeps the person's work: the line between the two is the
// whole command.
func TestUninstallRemovesTheBookkeepingInTheMountAndKeepsTheWorkspaces(t *testing.T) {
	fixture := newUninstallFixture(t)
	if err := fixture.remove.run(context.Background()); err != nil {
		t.Fatal(err)
	}
	for _, path := range fixture.bookkeeping {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Errorf("the bookkeeping at %s is still there: %v", path, err)
		}
	}
	if body, err := os.ReadFile(fixture.workspace); err != nil || string(body) != "a person's work" {
		t.Errorf("a workspace file was touched: %q, %v", body, err)
	}
	conversation := filepath.Join(fixture.remove.root, "state", "conversations", "a-conversation.json")
	if _, err := os.Stat(conversation); err != nil {
		t.Errorf("a conversation under state/ was removed: %v", err)
	}
	if _, err := os.Stat(update.IsPath(fixture.remove.root)); !os.IsNotExist(err) {
		t.Errorf("our is.json is still there: %v", err)
	}
	for _, path := range []string{update.OwnedBinary(fixture.remove.home), applianceDisk(fixture.remove.home), filepath.Join(fixture.remove.home, "appliance")} {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Errorf("%s is still there: %v", path, err)
		}
	}
}

// There is no word that makes uninstall delete the mount: the command's whole surface is two folders.
func TestUninstallLeavesNoFlagThatDeletesTheMount(t *testing.T) {
	flags, _, _ := uninstallFlags()
	for _, name := range []string{"mount", "all", "yes", "purge", "delete"} {
		if flags.Lookup(name) != nil {
			t.Errorf("uninstall has a --%s flag, and it must not have one", name)
		}
	}
	if flags.Lookup("root") == nil || flags.Lookup("home") == nil {
		t.Error("uninstall needs --root and --home")
	}
}

// Uninstall then install leaves the person's work alone: the product is replaceable, the mount is not.
func TestInstallAfterUninstallKeepsTheWorkspaces(t *testing.T) {
	fixture := newUninstallFixture(t)
	installAgain := func() {
		again := installer{
			userHome:    fixture.remove.userHome,
			home:        fixture.remove.home,
			root:        fixture.remove.root,
			version:     "v0.10.0-beta.16",
			declaration: update.Declaration{Wanted: update.IntentRunning},
			binary:      []byte("the running binary"),
			init:        fixture.init,
			kvm:         func() error { return nil },
		}
		if err := again.run(context.Background(), func(bool, string) {}); err != nil {
			t.Fatalf("install: %v", err)
		}
	}
	if err := fixture.remove.run(context.Background()); err != nil {
		t.Fatal(err)
	}
	installAgain()
	if body, err := os.ReadFile(fixture.workspace); err != nil || string(body) != "a person's work" {
		t.Errorf("the workspace did not survive an uninstall and an install: %q, %v", body, err)
	}
}

// purgeFixture is an install with a mount to destroy, and a sink for what the purge says.
type purgeFixture struct {
	purge    purger
	init     *fakeInit
	said     *[]string
	uninstal *int
}

func newPurgeFixture(t *testing.T, yes bool) purgeFixture {
	t.Helper()
	userHome := t.TempDir()
	home := filepath.Join(userHome, ".acornfall")
	root := filepath.Join(userHome, "acornfall")
	for _, path := range []string{update.OwnedBinary(home), filepath.Join(home, "appliance", "a.tar.gz"), filepath.Join(root, "state", "machine.json"), filepath.Join(root, "workspaces", "general", "notes.md")} {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte("x"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	init := &fakeInit{unitPath: filepath.Join(userHome, ".config", "systemd", "user", "acornfall-machine.service"), linger: true}
	if err := os.MkdirAll(filepath.Dir(init.unitPath), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(init.unitPath, []byte("unit"), 0o644); err != nil {
		t.Fatal(err)
	}
	said := &[]string{}
	calls := new(int)
	remove := uninstaller{userHome: userHome, home: home, root: root, init: init, machine: &fakeMachine{}, say: func(string, string) {}}
	fixture := purgeFixture{init: init, said: said, uninstal: calls}
	fixture.purge = purger{
		userHome: userHome,
		home:     home,
		root:     root,
		yes:      yes,
		init:     init,
		uninstall: func(ctx context.Context) error {
			*calls++
			return remove.run(ctx)
		},
		say: func(kind, sentence string) { *said = append(*said, kind+" "+sentence) },
	}
	return fixture
}

// Without --yes a purge removes nothing at all, and the list is the dry run.
func TestPurgeWithoutYesRemovesNothing(t *testing.T) {
	fixture := newPurgeFixture(t, false)
	err := fixture.purge.run(context.Background())
	if err == nil || !strings.Contains(err.Error(), "nothing removed: pass --yes") {
		t.Fatalf("want a refusal naming --yes, got %v", err)
	}
	for _, path := range []string{fixture.purge.home, fixture.purge.root, fixture.init.unitPath} {
		if _, statErr := os.Stat(path); statErr != nil {
			t.Errorf("%s was removed without --yes: %v", path, statErr)
		}
	}
	listing := strings.Join(*fixture.said, "\n")
	if !strings.Contains(listing, fixture.purge.home) || !strings.Contains(listing, fixture.purge.root) {
		t.Errorf("the list does not name what it would remove:\n%s", listing)
	}
	if *fixture.uninstal != 0 {
		t.Errorf("the uninstall ran without --yes")
	}
}

// With --yes it removes the unit, the home and the mount, and turns linger off so the service does not come back.
func TestPurgeRemovesTheUnitTheHomeAndTheMount(t *testing.T) {
	fixture := newPurgeFixture(t, true)
	if err := fixture.purge.run(context.Background()); err != nil {
		t.Fatal(err)
	}
	for _, path := range []string{fixture.purge.home, fixture.purge.root, fixture.init.unitPath} {
		if _, err := os.Stat(path); !os.IsNotExist(err) {
			t.Errorf("%s is still there: %v", path, err)
		}
	}
	if fixture.init.lingerOff != 1 {
		t.Errorf("linger was turned off %d times, want once", fixture.init.lingerOff)
	}
}

// Linger is its own assertion because it is what makes a removed service stay removed: the unit is gone, and a
// lingering user unit would be started again at the next boot.
func TestPurgeTurnsLingerOff(t *testing.T) {
	fixture := newPurgeFixture(t, true)
	if err := fixture.purge.run(context.Background()); err != nil {
		t.Fatal(err)
	}
	if fixture.init.linger {
		t.Error("linger is still on after a purge")
	}
}

// A purge can run before or after an uninstall: when the service is installed it does the uninstall first, in the
// same run, so one command is always enough.
func TestPurgeRunsUninstallFirstWhenTheServiceIsInstalled(t *testing.T) {
	fixture := newPurgeFixture(t, true)
	if err := fixture.purge.run(context.Background()); err != nil {
		t.Fatal(err)
	}
	if *fixture.uninstal != 1 {
		t.Fatalf("the uninstall ran %d times", *fixture.uninstal)
	}
	if _, err := os.Stat(applianceDisk(fixture.purge.home)); !os.IsNotExist(err) {
		t.Errorf("the machine's disk survived the purge: %v", err)
	}
}

// A workspace the registry names outside the mount is the person's own folder: a purge prints it and never deletes
// it.
func TestPurgeLeavesAWorkspaceOutsideTheMount(t *testing.T) {
	fixture := newPurgeFixture(t, true)
	elsewhere := t.TempDir()
	registry := control.RegistryFile{Workspaces: []control.Workspace{{Name: "other", Path: elsewhere}}}
	if err := os.MkdirAll(filepath.Join(fixture.purge.root, "state"), 0o755); err != nil {
		t.Fatal(err)
	}
	payload := `{"workspaces":[{"name":"other","path":` + quote(elsewhere) + `,"title":"","general":false}]}`
	if err := os.WriteFile(filepath.Join(fixture.purge.root, "state", "workspaces.json"), []byte(payload), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(elsewhere, "a-file"), []byte("mine"), 0o644); err != nil {
		t.Fatal(err)
	}
	_ = registry
	if err := fixture.purge.run(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(elsewhere, "a-file")); err != nil {
		t.Errorf("a workspace outside the mount was touched: %v", err)
	}
	if listing := strings.Join(*fixture.said, "\n"); !strings.Contains(listing, elsewhere) {
		t.Errorf("the outside workspace was not printed:\n%s", listing)
	}
}

// The one path a purge must never take: the root of the file system, a home directory itself, or a symlink.
func TestPurgeRefusesRoot(t *testing.T) {
	userHome := t.TempDir()
	for _, path := range []string{"/", "/root", userHome, "/home/someone"} {
		if err := removablePath("the mount", path, userHome); err == nil {
			t.Errorf("%q should be refused", path)
		}
	}
	if err := removablePath("the mount", filepath.Join(userHome, "acornfall"), userHome); err != nil {
		t.Errorf("an install's own folder is removable: %v", err)
	}
}

// A symlinked mount is refused rather than followed: what it points at is not the install, and a purge that
// followed one would remove a folder it was never asked about.
func TestPurgeRefusesASymlinkedMount(t *testing.T) {
	userHome := t.TempDir()
	real := filepath.Join(userHome, "real", "acornfall")
	if err := os.MkdirAll(filepath.Join(real, "keep"), 0o755); err != nil {
		t.Fatal(err)
	}
	link := filepath.Join(userHome, "link-to-mount")
	if err := os.Symlink(real, link); err != nil {
		t.Fatal(err)
	}
	fixture := newPurgeFixture(t, true)
	fixture.purge.root = link
	err := fixture.purge.run(context.Background())
	if err == nil || !strings.Contains(err.Error(), "symlink") {
		t.Fatalf("want a refusal naming the symlink, got %v", err)
	}
	if _, statErr := os.Stat(filepath.Join(real, "keep")); statErr != nil {
		t.Errorf("what the symlink points at was removed: %v", statErr)
	}
}

func quote(value string) string {
	return `"` + strings.ReplaceAll(value, `\`, `\\`) + `"`
}

func itoa(value int) string { return strconv.Itoa(value) }

// The other half of a repair: a unit that is there but not enabled, or a service that is not running, is fixed
// and said so. That is what "run install again if something is wrong" means.
func TestInstallFixesAUnitThatIsNotEnabledAndAServiceThatIsNotRunning(t *testing.T) {
	fixture := newInstallFixture(t, update.Declaration{Wanted: update.IntentRunning, Host: "127.0.0.1", Port: 7777})
	fixture.run(t)
	// The unit is right and the declaration is right; the service is merely off.
	fixture.init.enabled = false
	fixture.init.active = false
	*fixture.say = nil
	fixture.run(t)
	if fixture.init.enableCalls < 2 {
		t.Errorf("the service was enabled %d times, want a second fix", fixture.init.enableCalls)
	}
	found := false
	for _, line := range *fixture.say {
		if strings.HasPrefix(line, "fixed") && strings.Contains(line, "the service") {
			found = true
		}
	}
	if !found {
		t.Errorf("a service that was not running was not said to be fixed: %v", *fixture.say)
	}
}

// Changing the answer later is one command: the declaration and the unit move, and the machine is taken away so
// it is made again on the new address — a machine's address is fixed when it is created.
func TestInstallingWithANewAddressRecreatesARunningMachine(t *testing.T) {
	for _, c := range []struct {
		name        string
		running     bool
		wantRemoves int
	}{
		{name: "running", running: true, wantRemoves: 1},
		{name: "not running", running: false, wantRemoves: 1},
	} {
		t.Run(c.name, func(t *testing.T) {
			fixture := newInstallFixture(t, update.Declaration{Wanted: update.IntentRunning, Host: "127.0.0.1", Port: 7777})
			fixture.run(t)
			machine := &fakeMachine{running: c.running}
			fixture.install.machine = machine
			// The person answers the other way this time.
			fixture.install.declaration = update.Declaration{Wanted: update.IntentRunning, Host: "0.0.0.0", Port: 7777}
			fixture.run(t)
			if machine.removes != c.wantRemoves {
				t.Errorf("the machine was removed %d times, want %d", machine.removes, c.wantRemoves)
			}
			if got, _ := update.ReadDeclaration(fixture.install.root).Address(); got != "0.0.0.0" {
				t.Errorf("the declaration says %q", got)
			}
			body, err := os.ReadFile(fixture.init.unitPath)
			if err != nil {
				t.Fatal(err)
			}
			if !strings.Contains(string(body), "--host 0.0.0.0") {
				t.Errorf("the unit still says the old address:\n%s", body)
			}
		})
	}
}

// An upgrade is a new binary, and a service that is already running would go on being the previous release:
// the install restarts it. Without this, installing beta.N+1 changed the symlink and nothing else.
func TestInstallRestartsTheServiceWhenTheBinaryChanges(t *testing.T) {
	fixture := newInstallFixture(t, update.Declaration{Wanted: update.IntentRunning, Host: "127.0.0.1", Port: 7777})
	fixture.run(t)
	restarts := fixture.init.restarts
	// The next release, with its own binary.
	fixture.install.version = "v0.10.0-beta.17"
	fixture.install.binary = []byte("the next running binary")
	*fixture.say = nil
	fixture.run(t)
	if fixture.init.restarts <= restarts {
		t.Errorf("the service was not restarted for a new binary: %d restarts", fixture.init.restarts)
	}
	found := false
	for _, line := range *fixture.say {
		if strings.Contains(line, "restarted the service") {
			found = true
		}
	}
	if !found {
		t.Errorf("the restart was not said: %v", *fixture.say)
	}
}

// A machine made by an earlier release carries that release's init and runs on that release's disk, so an
// upgrade takes the machine away before it replaces the disk — whether or not the engine says it is running,
// because a VM still holding the old tree boots into nothing while its port stays bound.
func TestInstallRecreatesTheMachineWhenTheReleaseChanges(t *testing.T) {
	for _, c := range []struct {
		name        string
		running     bool
		wantRemoves int
	}{
		{name: "running", running: true, wantRemoves: 1},
		{name: "not running", running: false, wantRemoves: 1},
	} {
		t.Run(c.name, func(t *testing.T) {
			fixture := newInstallFixture(t, update.Declaration{Wanted: update.IntentRunning, Host: "127.0.0.1", Port: 7777})
			// The disk is the previous release's, and the machine is or is not running on it.
			makeRunningDisk(t, fixture.install.home, "v0.10.0-beta.15")
			machine := &fakeMachine{running: c.running}
			fixture.install.machine = machine
			fixture.run(t)
			if machine.removes != c.wantRemoves {
				t.Errorf("the machine was removed %d times, want %d", machine.removes, c.wantRemoves)
			}
			// And the disk is this release's, whether or not the machine was running: removing the machine is not
			// upgrading it, and the service would make the next one from the disk that was there.
			if tag := applianceDiskTag(applianceDisk(fixture.install.home)); tag != fixture.install.version {
				t.Errorf("the disk is %q, want %q", tag, fixture.install.version)
			}
		})
	}
}

// The verification names the checks that failed: "one of these three" sends a person to read three things, and
// a console that answers 401 is a machine from an earlier release, not a broken install.
func TestTheVerifySaysWhichCheckFailed(t *testing.T) {
	root := t.TempDir()
	inactive := &fakeInit{unitPath: filepath.Join(root, "unit")}
	clock := &fakeClock{at: time.Date(2026, 10, 22, 18, 0, 0, 0, time.UTC)}
	// The wait advances the clock instead of sleeping, and the context is already over: the console check would
	// otherwise sit out its own two-second retry on every pass.
	wait := func(d time.Duration) { clock.advance(d + 20*time.Second) }
	ctx, cancel := context.WithTimeout(context.Background(), time.Millisecond)
	defer cancel()
	err := verifyUp(ctx, inactive, root, unitConfig{UserHome: root, Home: root, Root: root, Host: "127.0.0.1", Port: 6553}, clock.now, wait)
	if err == nil {
		t.Fatal("an inactive unit is not up")
	}
	for _, want := range []string{"unit is not active", "was not written", "did not answer"} {
		if !strings.Contains(err.Error(), want) {
			t.Errorf("the sentence should name %q: %v", want, err)
		}
	}
	// With the state written and the unit active, only the console is missing — and it says so alone.
	if err := update.WriteIs(root, update.HostState{Running: true, At: update.StampedAt(time.Now())}); err != nil {
		t.Fatal(err)
	}
	active := &fakeInit{unitPath: filepath.Join(root, "unit"), active: true}
	err = verifyUp(ctx, active, root, unitConfig{UserHome: root, Home: root, Root: root, Host: "127.0.0.1", Port: 6553}, clock.now, wait)
	if err == nil || !strings.Contains(err.Error(), "did not answer") {
		t.Fatalf("want the console named, got %v", err)
	}
	if strings.Contains(err.Error(), "unit is not active") || strings.Contains(err.Error(), "was not written") {
		t.Errorf("only the console failed: %v", err)
	}
}

// The console the install verifies is the machine's, not whatever answers on that port. A gateway from a hand
// install is the old shape and another engine: it would pass for the machine while having no sandbox behind it.
func TestTheVerifyKnowsWhichConsoleItIsTalkingTo(t *testing.T) {
	for _, c := range []struct {
		name string
		body string
		want string
	}{
		{name: "the machine's console", body: `{"sandbox":{"engine":"lxc","tools":true}}`},
		{name: "another engine", body: `{"sandbox":{"engine":"microsandbox"}}`, want: "microsandbox"},
		{name: "an older shape", body: `{"sandbox":"microsandbox"}`, want: "not this version's shape"},
	} {
		t.Run(c.name, func(t *testing.T) {
			server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
				_, _ = w.Write([]byte(c.body))
			}))
			defer server.Close()
			err := consoleIsTheMachine(context.Background(), server.URL)
			if c.want == "" {
				if err != nil {
					t.Fatalf("the machine's console should pass: %v", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), c.want) {
				t.Fatalf("want a sentence naming %q, got %v", c.want, err)
			}
		})
	}
	// A console that is not there is the other check's sentence, not this one's.
	if err := consoleIsTheMachine(context.Background(), "http://127.0.0.1:1"); err != nil {
		t.Errorf("a missing console is not this check's answer: %v", err)
	}
}

// A machine made before the disk carried a release tag is not this release's machine, and it cannot say so
// itself: the install treats "does not say" as stale, which is what an upgrade from an older beta is.
func TestInstallRecreatesAMachineFromBeforeTheTagRecord(t *testing.T) {
	fixture := newInstallFixture(t, update.Declaration{Wanted: update.IntentRunning, Host: "127.0.0.1", Port: 7777})
	// The disk of a machine from an older release: the files, and no tag beside them.
	disk := applianceDisk(fixture.install.home)
	writeApplianceFiles(t, disk, "")
	machine := &fakeMachine{running: true}
	fixture.install.machine = machine
	fixture.run(t)
	if machine.removes != 1 {
		t.Errorf("a machine that does not say which release it is was kept: %d removals", machine.removes)
	}
}

// An install does not touch a machine while another process holds the disk: the removal is inside the lock, so a
// refused lock means nothing was taken away — not a machine removed for a disk that was never made.
func TestAnInstallDoesNotTouchTheMachineWhenTheDiskIsLocked(t *testing.T) {
	fixture := newInstallFixture(t, update.Declaration{Wanted: update.IntentRunning, Host: "127.0.0.1", Port: 7777})
	machine := &fakeMachine{running: true}
	fixture.install.machine = machine
	unlock, _, err := update.AcquireLock(fixture.install.root, time.Now())
	if err != nil {
		t.Fatal(err)
	}
	defer unlock()
	if err := fixture.install.run(context.Background(), func(bool, string) {}); err == nil {
		t.Fatal("an install must refuse while another update holds the disk")
	} else if !strings.Contains(err.Error(), "one update at a time") {
		t.Errorf("the refusal should say what holds it: %v", err)
	}
	if machine.removes != 0 {
		t.Errorf("the machine was taken away without the disk: %d removals", machine.removes)
	}
}
