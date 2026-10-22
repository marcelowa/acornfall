package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"

	"github.com/acornfall/acornfall/gateway/internal/control"
	"github.com/acornfall/acornfall/gateway/internal/update"
)

// fakeInit is the service manager, as a test needs it: a unit path and its content, and flags for the verbs
// that start, stop and linger it.
type fakeInit struct {
	unitPath     string
	active       bool
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
	userHome := t.TempDir()
	home := filepath.Join(userHome, ".acornfall")
	root := filepath.Join(userHome, "acornfall")
	init := &fakeInit{unitPath: filepath.Join(userHome, ".config", "systemd", "user", "acornfall-machine.service")}
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
	fixture.run(t)

	// The first run fixed what was missing; the second found all of it.
	second := (*fixture.say)[len(*fixture.say)/2:]
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

// A remote install answers for a console anyone on the network can reach, so it needs a token, and the token is
// the file the gateway reads: 0600, and not empty.
func TestRemoteWithoutATokenCreatesOneWithMode0600(t *testing.T) {
	root := t.TempDir()
	created, err := ensureToken(root)
	if err != nil {
		t.Fatal(err)
	}
	if !created {
		t.Error("a missing token was not created")
	}
	path := filepath.Join(root, "config", "token")
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Errorf("the token is %v, want 0600", info.Mode().Perm())
	}
	if body, _ := os.ReadFile(path); len(strings.TrimSpace(string(body))) != 64 {
		t.Errorf("the token is %d characters, want 32 bytes as hex", len(strings.TrimSpace(string(body))))
	}
	// A token that is there is not replaced: rotating it is not an install's business.
	if created, err := ensureToken(root); err != nil || created {
		t.Errorf("an existing token was rewritten: created=%v err=%v", created, err)
	}
}

// If the token cannot be written, a remote install is refused: falling back to an unauthenticated console on a
// network address is the one outcome this must never have.
func TestRemoteWithAnUnwritableConfigDirRefuses(t *testing.T) {
	root := t.TempDir()
	// A file where the config folder belongs: nothing can be created under it.
	if err := os.WriteFile(filepath.Join(root, "config"), []byte("not a folder"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := ensureToken(root); err == nil {
		t.Fatal("an unwritable token must refuse the install")
	}
}

// No terminal and no flag is a refusal that names both flags: guessing a network bind is guessing a console open
// to the network.
func TestNoTTYAndNoFlagRefuses(t *testing.T) {
	_, err := remoteAnswer(false, false, false)
	if err == nil {
		t.Fatal("an install with no answer must refuse")
	}
	for _, name := range []string{"--local", "--remote"} {
		if !strings.Contains(err.Error(), name) {
			t.Errorf("the refusal should name %s: %v", name, err)
		}
	}
	if remote, err := remoteAnswer(true, false, false); err != nil || !remote {
		t.Errorf("--remote = %v, %v", remote, err)
	}
	if remote, err := remoteAnswer(false, true, false); err != nil || remote {
		t.Errorf("--local = %v, %v", remote, err)
	}
	if _, err := remoteAnswer(true, true, false); err == nil {
		t.Error("--remote and --local together is not an answer")
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
	machine := &fakeMachine{running: true}
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
	if got, want := strings.Join(*fixture.order, ","), "disable"; got != want {
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
