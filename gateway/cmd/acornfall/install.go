package main

// Installing and removing the host service (ADR 0030, amended). `machine install` puts the product where
// it belongs and repairs what drifted; `machine uninstall` removes what we installed and keeps what a
// person made; `machine purge` removes everything, and refuses to do it without `--yes`. The unit files
// are generated from a copy embedded in the binary: nobody edits a unit by hand, and no install can
// disagree with the declaration the commands read.

import (
	"context"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/acornfall/acornfall/gateway/internal/control"
	"github.com/acornfall/acornfall/gateway/internal/layout"
	"github.com/acornfall/acornfall/gateway/internal/update"
)

//go:embed units/acornfall-machine.service.tmpl
var systemdUnit string

//go:embed units/dev.acornfall.machine.plist.tmpl
var launchdUnit string

// unitConfig is everything a generated unit says: the symlink it starts, the two folders, and the address
// the console is published on. It is rendered from the declaration, never edited afterwards.
type unitConfig struct {
	UserHome  string
	Machinery string
	Share     string
	Host      string
	Port      int
}

// unitFor renders the unit this platform's init reads and says where it goes. Anything else is refused by
// name: there is no unit to write, and guessing one is how an install half-happens.
func unitFor(goos string, cfg unitConfig) (path, content string, err error) {
	unit := strings.NewReplacer(
		"{{BINARY}}", update.OwnedBinary(cfg.Machinery),
		"{{SHARE}}", cfg.Share,
		"{{MACHINERY}}", cfg.Machinery,
		"{{HOST}}", cfg.Host,
		"{{PORT}}", strconv.Itoa(cfg.Port),
	)
	switch goos {
	case "linux":
		return filepath.Join(cfg.UserHome, ".config", "systemd", "user", "acornfall-machine.service"), unit.Replace(systemdUnit), nil
	case "darwin":
		return filepath.Join(cfg.UserHome, "Library", "LaunchAgents", "dev.acornfall.machine.plist"), unit.Replace(launchdUnit), nil
	default:
		return "", "", fmt.Errorf("this is %s, which has no service manager this installer knows: it installs on Linux with systemd, or on macOS with launchd", goos)
	}
}

// initSystem is the service manager, as much of it as the product needs: where the unit goes, what it
// says, the verbs that start and stop it, and whether it is up.
type initSystem interface {
	Name() string
	Unit(cfg unitConfig) (path, content string, err error)
	Reload(ctx context.Context) error
	Enable(ctx context.Context) error
	Disable(ctx context.Context) error
	Enabled(ctx context.Context) (bool, error)
	Restart(ctx context.Context) error
	Active(ctx context.Context) bool
	Linger(ctx context.Context) (bool, error)
	EnableLinger(ctx context.Context) error
	DisableLinger(ctx context.Context) error
}

// systemdInit is the Linux one: a user unit, a daemon-reload after every write, and linger so the service
// starts at boot rather than only while somebody is logged in.
type systemdInit struct{}

func (systemdInit) Name() string { return "systemd" }

func (systemdInit) Unit(cfg unitConfig) (string, string, error) { return unitFor("linux", cfg) }

func (systemdInit) Reload(ctx context.Context) error {
	return runInit(ctx, "systemctl", "--user", "daemon-reload")
}

func (systemdInit) Enable(ctx context.Context) error {
	return runInit(ctx, "systemctl", "--user", "enable", "--now", "acornfall-machine.service")
}

func (systemdInit) Disable(ctx context.Context) error {
	return runInit(ctx, "systemctl", "--user", "disable", "--now", "acornfall-machine.service")
}

func (systemdInit) Active(ctx context.Context) bool {
	return runInit(ctx, "systemctl", "--user", "is-active", "--quiet", "acornfall-machine.service") == nil
}

func (systemdInit) Enabled(ctx context.Context) (bool, error) {
	err := runInit(ctx, "systemctl", "--user", "is-enabled", "--quiet", "acornfall-machine.service")
	if err != nil {
		// A unit that is not enabled is an answer, not a failure; anything else is the init complaining.
		if strings.Contains(err.Error(), "exit status 1") {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

func (systemdInit) Restart(ctx context.Context) error {
	return runInit(ctx, "systemctl", "--user", "restart", "acornfall-machine.service")
}

func (systemdInit) Linger(ctx context.Context) (bool, error) {
	output, err := initOutput(ctx, "loginctl", "show-user", currentUser(), "-p", "Linger")
	if err != nil {
		return false, err
	}
	return strings.Contains(output, "Linger=yes"), nil
}

func (systemdInit) EnableLinger(ctx context.Context) error {
	return runInit(ctx, "loginctl", "enable-linger", currentUser())
}

func (systemdInit) DisableLinger(ctx context.Context) error {
	return runInit(ctx, "loginctl", "disable-linger", currentUser())
}

// launchdInit is the macOS one. launchd has no linger (a LaunchAgent runs when the user is logged in) and
// no StartLimit, which the plist's own comments say.
type launchdInit struct{}

func (launchdInit) Name() string { return "launchd" }

func (launchdInit) Unit(cfg unitConfig) (string, string, error) { return unitFor("darwin", cfg) }

func (launchdInit) Reload(context.Context) error { return nil }

func (launchdInit) Enable(ctx context.Context) error {
	path, _, err := launchdInit{}.Unit(unitConfig{UserHome: userHomeDir()})
	if err != nil {
		return err
	}
	return runInit(ctx, "launchctl", "bootstrap", launchdDomain(), path)
}

func (launchdInit) Disable(ctx context.Context) error {
	return runInit(ctx, "launchctl", "bootout", launchdDomain()+"/dev.acornfall.machine")
}

func (launchdInit) Active(ctx context.Context) bool {
	return runInit(ctx, "launchctl", "print", launchdDomain()+"/dev.acornfall.machine") == nil
}

// Enabled is true once the agent is bootstrapped: launchd has no separate "enabled" a person sets.
func (launchdInit) Enabled(ctx context.Context) (bool, error) { return launchdInit{}.Active(ctx), nil }

func (launchdInit) Restart(ctx context.Context) error {
	return runInit(ctx, "launchctl", "kickstart", "-k", launchdDomain()+"/dev.acornfall.machine")
}

func (launchdInit) Linger(context.Context) (bool, error) { return true, nil }

func (launchdInit) EnableLinger(context.Context) error { return nil }

func (launchdInit) DisableLinger(context.Context) error { return nil }

func launchdDomain() string { return "gui/" + strconv.Itoa(os.Getuid()) }

func currentUser() string {
	if who, err := user.Current(); err == nil && who.Username != "" {
		return who.Username
	}
	return os.Getenv("USER")
}

func userHomeDir() string {
	if machinery, err := os.UserHomeDir(); err == nil {
		return machinery
	}
	return os.Getenv("HOME")
}

// initFor picks the service manager this platform has, or nil: the caller refuses by name rather than
// guessing, because a guessed init is an install that reports success and starts nothing.
func initFor(goos string) initSystem {
	switch goos {
	case "linux":
		return systemdInit{}
	case "darwin":
		return launchdInit{}
	default:
		return nil
	}
}

// runInit runs one init command, and keeps its own output out of the transcript unless it failed: a person
// reading an install does not need systemd's, and a failure does.
func runInit(ctx context.Context, name string, args ...string) error {
	output, err := initOutput(ctx, name, args...)
	if err != nil {
		if trimmed := strings.TrimSpace(output); trimmed != "" {
			return fmt.Errorf("%s %s: %v: %s", name, strings.Join(args, " "), err, trimmed)
		}
	}
	return err
}

func initOutput(ctx context.Context, name string, args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(ctx, 30*time.Second)
	defer cancel()
	output, err := exec.CommandContext(ctx, name, args...).CombinedOutput()
	return string(output), err
}

// installer is `machine install` without the flags: the parts it touches are fields, so a test drives a
// first install, a repair and a second run without systemd.
type installer struct {
	userHome    string
	machinery   string
	share       string
	version     string
	declaration update.Declaration
	binary      []byte
	init        initSystem
	// machine is how a changed address reaches the machine that is already running: it is recreated, because a
	// machine's address is fixed when it is created. Nil on a host where nothing is running.
	machine machineControl
	// kvm and verify are the two host checks: a test replaces them.
	kvm    func() error
	verify func(ctx context.Context, cfg unitConfig) error
	// pathDir is --path-dir: where the command link goes, overriding the search. pathDirs is the
	// search itself, nil in production; a test passes an empty slice to keep the host untouched.
	pathDir  string
	pathDirs []string
}

// run installs, repairs, and says one line per item: `ok` for what was already right, `fixed` for what it
// changed. A second run straight after the first writes nothing at all.
func (in installer) run(ctx context.Context, say func(ok bool, line string)) error {
	if in.init == nil {
		return fmt.Errorf("this is %s, which has no service manager this installer knows: it installs on Linux with systemd, or on macOS with launchd", runtime.GOOS)
	}
	if in.kvm != nil {
		if err := in.kvm(); err != nil {
			return err
		}
	}
	cfg := unitConfig{
		UserHome:  in.userHome,
		Machinery: in.machinery,
		Share:     in.share,
		Host:      in.declaration.Host,
		Port:      in.declaration.Port,
	}
	if cfg.Host == "" {
		cfg.Host, cfg.Port = in.declaration.Address()
	}
	previous := update.ReadDeclaration(in.share)
	previousHost, previousPort := previous.Address()
	addressChanged := previousHost != cfg.Host || previousPort != cfg.Port

	// The binary, under the release's own name, and the symlink the unit starts.
	versioned := update.VersionedBinary(in.machinery, in.version)
	written, err := writeIfDifferent(versioned, in.binary, 0o755)
	binaryWritten := written
	if err != nil {
		return fmt.Errorf("putting the binary at %s: %w", versioned, err)
	}
	if err := checkExecutable(versioned, len(in.binary)); err != nil {
		return err
	}
	say(!written, "the binary at "+versioned)
	linked, err := pointIfDifferent(update.OwnedBinary(in.machinery), versioned)
	binaryWritten = binaryWritten || linked
	if err != nil {
		return fmt.Errorf("pointing %s at %s: %w", update.OwnedBinary(in.machinery), versioned, err)
	}
	say(!linked, "the symlink at "+update.OwnedBinary(in.machinery))

	// The command a person types. The unit starts the owned symlink; this link is only for the
	// shell's PATH, so a fresh install does not document every command with ~/.acornfall/bin/.
	// A directory already on PATH wins; a directory outside it is never chosen, because a link
	// nobody's shell searches is a link that fixes nothing.
	pathLink, pathWrote, err := installPathLink(in.machinery, in.userHome, in.pathDir, in.pathDirs)
	if err != nil {
		return err
	}
	if pathLink != "" {
		say(!pathWrote, "the command at "+pathLink)
	} else {
		say(true, "acornfall is not on PATH: add "+filepath.Dir(update.OwnedBinary(in.machinery))+" to PATH, or run `machine install --path-dir <dir>`")
	}

	// The unit, generated from the embedded copy: never edited, and always the declaration's address.
	unitPath, unitContent, err := in.init.Unit(cfg)
	if err != nil {
		return err
	}
	unitWritten, err := writeIfDifferent(unitPath, []byte(unitContent), 0o644)
	if err != nil {
		return fmt.Errorf("writing the unit at %s: %w", unitPath, err)
	}
	say(!unitWritten, "the "+in.init.Name()+" unit at "+unitPath)

	// The declaration the other commands read: it exists, and it agrees with the unit.
	declarationWritten := previous != in.declaration
	if declarationWritten {
		if err := update.WriteDeclaration(in.share, in.declaration); err != nil {
			return fmt.Errorf("writing the declaration: %w", err)
		}
	}
	say(!declarationWritten, "the declaration at "+update.MachineIntentPath(in.share))
	// The release this install just put in place is the one the product wants. A stale want.json
	// from an earlier update would otherwise make the service apply that older release to the
	// machine we just installed.
	if update.IsReleaseVersion(in.version) {
		if err := update.WriteWant(in.share, in.version); err != nil {
			return fmt.Errorf("recording the installed release in want.json: %w", err)
		}
	} else {
		_ = os.Remove(update.WantPath(in.share))
	}
	if addressChanged {
		say(false, fmt.Sprintf("the address, from %s:%d to %s:%d (the declaration and the unit both)", previousHost, previousPort, cfg.Host, cfg.Port))
	}

	// The service: reloaded after a write, enabled, and lingered so it starts at boot.
	if unitWritten {
		if err := in.init.Reload(ctx); err != nil {
			return err
		}
	}
	enabled, err := in.init.Enabled(ctx)
	if err != nil {
		return err
	}
	active := in.init.Active(ctx)
	if !enabled || !active {
		if err := in.init.Enable(ctx); err != nil {
			return err
		}
	}
	say(enabled && active && !unitWritten, "the service, enabled and running")
	if unitWritten || addressChanged || binaryWritten {
		// The unit is what starts it, the address is read at start-up, and the binary is the process itself: a
		// service that is already running would go on being the previous release, publishing the previous
		// address, until something restarted it. An upgrade that leaves the old process running is an upgrade
		// that did nothing.
		if err := in.init.Restart(ctx); err != nil {
			return err
		}
		say(false, "restarted the service, so it runs this release")
	}
	lingered, err := in.init.Linger(ctx)
	if err != nil {
		return err
	}
	if !lingered {
		if err := in.init.EnableLinger(ctx); err != nil {
			return err
		}
	}
	say(lingered, "linger, so it starts at boot without a login")

	// A machine's address and its init are fixed when it is created: a new address, or a release whose binary
	// is not the one the machine was made from, means the machine that is running is the old one. It is taken
	// away and the service makes it again; a machine that is not running is left, because its next start is the
	// new one.
	stale := addressChanged
	wasRunning := false
	if in.machine != nil {
		if running, err := in.machine.Running(ctx); err == nil {
			wasRunning = running
		}
		// A disk that does not say which release it is — every machine made before the disk carried a tag, which
		// includes every install that predates this release — is not this release's machine. That is the whole
		// question, so "" is stale too.
		if applianceRunningVersion(in.machinery) != in.version {
			stale = true
		}
	}
	if stale {
		if wasRunning {
			say(false, "recreated the machine, which was running the previous release or address")
		}
		// Removing the machine is not upgrading it: the body is the disk, and the disk is the release's. The
		// removal goes inside the lock that makes the disk — always, not only when the engine says the machine is
		// running — because a VM still holding the old tree is a machine that boots into nothing while its port
		// stays bound, and the service would make the next one from the disk that was there.
		if update.IsReleaseVersion(in.version) {
			remove := func() error {
				if in.machine == nil {
					return nil
				}
				return in.machine.Remove(ctx)
			}
			if _, err := applianceUp(ctx, in.machinery, in.share, in.version, remove); err != nil {
				return fmt.Errorf("making the machine's disk for %s: %w", in.version, err)
			}
			say(false, "made the machine's disk from "+in.version)
		}
	}
	// The check that it is actually up: the unit active, the state written, the console answering.
	if in.verify != nil {
		if err := in.verify(ctx, cfg); err != nil {
			return err
		}
	}
	return nil
}

// pathLinkPath is where the install records the command link it made, so an uninstall removes that
// one and not a binary somebody else put at the same name.
func pathLinkPath(machinery string) string { return filepath.Join(machinery, "path-link") }

// installPathLink puts `acornfall` on PATH. The link points at the owned symlink, never at a
// versioned binary: an upgrade moves the owned symlink, and the command follows it.
func installPathLink(machinery, userHome, explicit string, candidates []string) (string, bool, error) {
	owned := update.OwnedBinary(machinery)
	dir := explicit
	onPath := true
	if dir == "" {
		dir, onPath = firstPathDir(candidates, userHome)
	}
	if dir == "" {
		return "", false, nil
	}
	if !filepath.IsAbs(dir) {
		return "", false, fmt.Errorf("--path-dir needs an absolute directory, got %q", dir)
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", false, fmt.Errorf("making the PATH directory %s: %w", dir, err)
	}
	link := filepath.Join(dir, "acornfall")
	wrote := false
	if info, err := os.Lstat(link); err == nil {
		if info.Mode()&os.ModeSymlink == 0 {
			return "", false, fmt.Errorf("%s is a real file, not a link this install made: remove it, or pass --path-dir for another directory", link)
		}
		target, err := os.Readlink(link)
		if err != nil {
			return "", false, fmt.Errorf("reading the link at %s: %w", link, err)
		}
		if filepath.Clean(target) != filepath.Clean(owned) {
			return "", false, fmt.Errorf("%s already points at %s, not at this install (%s): remove it, or pass --path-dir", link, target, owned)
		}
	} else if !os.IsNotExist(err) {
		return "", false, fmt.Errorf("looking at %s: %w", link, err)
	} else {
		if err := os.Symlink(owned, link); err != nil {
			return "", false, fmt.Errorf("putting the command at %s: %w", link, err)
		}
		wrote = true
	}
	record := pathLinkPath(machinery)
	recordWrote, err := writeIfDifferent(record, []byte(link+"\n"), 0o644)
	if err != nil {
		return "", false, fmt.Errorf("recording the command link: %w", err)
	}
	if recordWrote {
		wrote = true
	}
	if !onPath {
		return link, wrote, fmt.Errorf("%s is not on PATH: add it to PATH, or pass --path-dir for a directory that is", dir)
	}
	return link, wrote, nil
}

// firstPathDir is the first directory already on PATH that this install can write: /usr/local/bin
// for root, ~/.local/bin otherwise. A directory that is not on PATH is not a candidate; a link
// nobody's shell searches would only move the problem.
func firstPathDir(candidates []string, userHome string) (string, bool) {
	search := candidates
	if search == nil {
		search = []string{filepath.Join(userHome, ".local", "bin")}
		if os.Geteuid() == 0 {
			search = append([]string{"/usr/local/bin"}, search...)
		}
	}
	path := os.Getenv("PATH")
	for _, dir := range search {
		if dir == "" || !onPath(dir, path) {
			continue
		}
		if err := os.MkdirAll(dir, 0o755); err != nil {
			continue
		}
		probe := filepath.Join(dir, ".acornfall-write-test")
		file, err := os.OpenFile(probe, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o600)
		if err != nil {
			continue
		}
		_ = file.Close()
		_ = os.Remove(probe)
		return dir, true
	}
	return "", false
}

func onPath(dir, path string) bool {
	clean := filepath.Clean(dir)
	for _, entry := range filepath.SplitList(path) {
		if entry != "" && filepath.Clean(entry) == clean {
			return true
		}
	}
	return false
}

// removePathLink removes the command link an install recorded, and only when it still points at
// this install. A real file a person put at the same name is left alone.
func removePathLink(machinery string) string {
	record := pathLinkPath(machinery)
	payload, err := os.ReadFile(record)
	if err != nil {
		return ""
	}
	link := strings.TrimSpace(string(payload))
	if link == "" {
		return ""
	}
	info, err := os.Lstat(link)
	if err != nil || info.Mode()&os.ModeSymlink == 0 {
		_ = os.Remove(record)
		return ""
	}
	target, err := os.Readlink(link)
	if err != nil || filepath.Clean(target) != filepath.Clean(update.OwnedBinary(machinery)) {
		return ""
	}
	if err := os.Remove(link); err != nil && !os.IsNotExist(err) {
		return ""
	}
	_ = os.Remove(record)
	return link
}

// ensureShareOwner gives a root install one fixed, non-root owner. The machine presents that
// uid to the containers, so the container profile no longer depends on whether the person ran
// the installer as root; a normal-user install keeps its own uid and skips this.
func ensureShareOwner(share, machinery string) error {
	if runtime.GOOS != "linux" || os.Geteuid() != 0 {
		return nil
	}
	account, err := user.Lookup("acornfall")
	if err != nil {
		command := exec.Command("useradd", "--system", "--user-group", "--home-dir", share, "--shell", "/usr/sbin/nologin", "acornfall")
		if output, addErr := command.CombinedOutput(); addErr != nil {
			return fmt.Errorf("creating the acornfall user: %v: %s", addErr, strings.TrimSpace(string(output)))
		}
		account, err = user.Lookup("acornfall")
		if err != nil {
			return err
		}
	}
	// The engine is a child of the service; it needs the hypervisor like the service does — where
	// a group is what gates the device. A workspace's /dev/kvm is world-readable (the shim makes it
	// so) and its image has never heard of a kvm group, so `usermod` there fails over a permission
	// nobody needs, and the install stops before it starts (acornfall#99).
	if group, needed := kvmGroupToJoin(); needed {
		if output, addErr := exec.Command("usermod", "-aG", group, "acornfall").CombinedOutput(); addErr != nil {
			return fmt.Errorf("adding acornfall to the %s group: %v: %s", group, addErr, strings.TrimSpace(string(output)))
		}
	}
	uid, err := strconv.Atoi(account.Uid)
	if err != nil {
		return fmt.Errorf("reading the acornfall user's uid: %w", err)
	}
	gid, err := strconv.Atoi(account.Gid)
	if err != nil {
		return fmt.Errorf("reading the acornfall user's gid: %w", err)
	}
	for _, dir := range []string{share, machinery} {
		if err := os.MkdirAll(dir, 0o750); err != nil {
			return err
		}
		if err := chownTree(dir, uid, gid); err != nil {
			return err
		}
	}
	return nil
}

// kvmDevice and kvmGroup are the device and the group a host gates it with; variables so a test
// can name what it made.
var (
	kvmDevice = "/dev/kvm"
	kvmGroup  = "kvm"
)

// kvmGroupToJoin is the group the service user has to join, when a group is what gates the device.
//
// Three of the four answers are "no group": a host with no device has nothing to join, a device
// the world can open has nothing a group could add, and a device gated by a group that does not
// exist is a host whose own check (ready.hypervisor) will say so — none of them should stop an
// install, which is what happened inside an acornfall workspace.
func kvmGroupToJoin() (string, bool) {
	info, err := os.Stat(kvmDevice)
	if err != nil {
		return "", false
	}
	if info.Mode().Perm()&0o006 == 0o006 {
		return "", false
	}
	group, err := user.LookupGroup(kvmGroup)
	if err != nil {
		return "", false
	}
	return group.Name, true
}

// chownTree gives a whole tree to uid:gid, and skips what the filesystem will not let it change.
//
// A share that is partly read-only — the global resources a workspace mounts so its instructions
// cannot be rewritten from inside (ADR 0014) — is still a share the install can use. Refusing the
// whole install over one mount is how acornfall inside an acornfall workspace stopped at
// `lchown /srv/acornfall/.agents: read-only file system` (acornfall#99).
func chownTree(path string, uid, gid int) error {
	return chownTreeUsing(path, uid, gid, os.Lchown, readOnlyMount)
}

// chownTreeUsing is chownTree with the two calls it makes supplied, so a test can watch what it
// skipped without a read-only mount and without root.
func chownTreeUsing(path string, uid, gid int, chown func(string, int, int) error, readOnly func(string) bool) error {
	return filepath.Walk(path, func(current string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if info.IsDir() && readOnly(current) {
			return filepath.SkipDir
		}
		if err := chown(current, uid, gid); err != nil {
			// A read-only mount refuses the change itself, which is the same answer as the check
			// above and not a reason to fail.
			if errors.Is(err, syscall.EROFS) {
				return nil
			}
			return err
		}
		return nil
	})
}

// stReadOnly is ST_RDONLY from sys/mount.h: the syscall package does not name it, and it is the
// one flag in Statfs_t.Flags this needs. It marks a filesystem mounted read-only.
const stReadOnly = 1

// readOnlyMount is whether the filesystem a path is on was mounted read-only.
func readOnlyMount(path string) bool {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(path, &stat); err != nil {
		return false
	}
	return stat.Flags&stReadOnly != 0
}

// installClosing is what an install tells a person to open: the address, and — on a network address — the one
// line that says it is reachable by whoever can route to it. There is no token: the console asks for nothing.
func installClosing(host string, port int) []string {
	browsable := host
	if browsable == "" || browsable == "0.0.0.0" || browsable == "::" {
		browsable = "127.0.0.1"
		if host != "" {
			if name, err := os.Hostname(); err == nil && name != "" {
				browsable = name
			}
		}
	}
	url := "http://" + net.JoinHostPort(browsable, strconv.Itoa(port))
	if host == "127.0.0.1" || host == "" || host == "::1" {
		return []string{"open " + url, "it is on loopback: nothing outside this machine can reach it"}
	}
	return []string{"open " + url, "it is reachable from this network, and it asks for no token"}
}

// writeIfDifferent writes content when the file does not already hold it, and says whether it wrote. A file
// that is already right keeps its mtime, which is what makes a second install observably nothing.
func writeIfDifferent(path string, content []byte, mode os.FileMode) (bool, error) {
	if existing, err := os.ReadFile(path); err == nil && string(existing) == string(content) {
		return false, nil
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return false, err
	}
	if err := writeFileAtomic(path, content, mode); err != nil {
		return false, err
	}
	return true, nil
}

// pointIfDifferent moves a symlink only when it does not already name target.
func pointIfDifferent(link, target string) (bool, error) {
	if existing, err := os.Readlink(link); err == nil && existing == target {
		return false, nil
	}
	if err := update.PointAtPath(link, target); err != nil {
		return false, err
	}
	return true, nil
}

// checkExecutable verifies what a copy of the running binary has to be: the whole file, and executable.
func checkExecutable(path string, size int) error {
	info, err := os.Stat(path)
	if err != nil {
		return fmt.Errorf("the binary at %s: %w", path, err)
	}
	if info.Size() != int64(size) {
		return fmt.Errorf("the binary at %s is %d bytes and the running one is %d: the copy is not the binary", path, info.Size(), size)
	}
	if info.Mode().Perm()&0o111 == 0 {
		return fmt.Errorf("the binary at %s is not executable (%v)", path, info.Mode().Perm())
	}
	return nil
}

func writeFileAtomic(path string, content []byte, mode os.FileMode) error {
	dir := filepath.Dir(path)
	temp, err := os.CreateTemp(dir, "."+filepath.Base(path)+"-*")
	if err != nil {
		return err
	}
	tempPath := temp.Name()
	defer func() { _ = os.Remove(tempPath) }()
	if _, err := temp.Write(content); err != nil {
		_ = temp.Close()
		return err
	}
	if err := temp.Sync(); err != nil {
		_ = temp.Close()
		return err
	}
	if err := temp.Close(); err != nil {
		return err
	}
	if err := os.Chmod(tempPath, mode); err != nil {
		return err
	}
	return os.Rename(tempPath, path)
}

// kvmCheck is the one pre-flight that is a failure now rather than at the first boot: the machine is a
// microVM, and a user who cannot open /dev/kvm has a service that starts and cannot make one.
func kvmCheck() error {
	switch runtime.GOOS {
	case "linux":
	default:
		// macOS uses the hypervisor framework, not /dev/kvm.
		return nil
	}
	device, err := os.OpenFile("/dev/kvm", os.O_RDWR, 0)
	if err != nil {
		return fmt.Errorf("this user cannot reach /dev/kvm (%v): the machine is a microVM, so add this user to the kvm group and log in again", err)
	}
	return device.Close()
}

// consoleIsTheMachine asks the console which sandbox engine it has. The launcher's console is the machine's,
// and the machine's is lxc — it runs its own containers. Anything else is another process answering on that
// port: a gateway from a hand install, which is a console with no sandbox behind it and no tools, and which
// would otherwise pass for the machine because it answers.
func consoleIsTheMachine(ctx context.Context, url string) error {
	client := &http.Client{Timeout: 5 * time.Second}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url+"/api/state", nil)
	if err != nil {
		return err
	}
	response, err := client.Do(request)
	if err != nil {
		// A console that is not answering at all is the other check's sentence, not this one's.
		return nil
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		return nil
	}
	var state struct {
		Sandbox struct {
			Engine string `json:"engine"`
		} `json:"sandbox"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 4<<20)).Decode(&state); err != nil || state.Sandbox.Engine == "" {
		return fmt.Errorf("the console at %s is not this machine's: its state is not this version's shape, so another acornfall is answering on that port", url)
	}
	if state.Sandbox.Engine != "lxc" {
		return fmt.Errorf("the console at %s reports the %q sandbox: the machine's console reports lxc, so another acornfall is answering on that port", url, state.Sandbox.Engine)
	}
	return nil
}

// verifyUp is the real check after an install: the unit is active, the state the console reads has been
// written, and the console answers on the declared address. A failure names the checks that failed, because
// "one of these three" is a sentence that sends a person to read three things.
func verifyUp(ctx context.Context, init initSystem, share string, cfg unitConfig, now func() time.Time, sleep func(time.Duration)) error {
	url := consoleURL(cfg.Host, cfg.Port)
	// Long enough for a machine that has to be made and booted: the unit is up in a second, the state follows,
	// and the console is the last thing — a fresh microVM takes half a minute to answer on a quiet host.
	const within = 90 * time.Second
	deadline := now().Add(within)
	for {
		failing := failingChecks(ctx, init, share, url)
		if len(failing) == 0 {
			return nil
		}
		if now().After(deadline) {
			return fmt.Errorf("the service is not up after %s: %s", within, strings.Join(failing, "; "))
		}
		sleep(time.Second)
	}
}

// failingChecks is every part of "up" that is not true, in the words of the thing that is wrong.
func failingChecks(ctx context.Context, init initSystem, share, url string) []string {
	var failing []string
	if !init.Active(ctx) {
		failing = append(failing, "the "+init.Name()+" unit is not active")
	}
	if _, ok := update.ReadIs(share); !ok {
		failing = append(failing, update.IsPath(share)+" was not written")
	}
	if err := consoleIsTheMachine(ctx, url); err != nil {
		failing = append(failing, err.Error())
	}
	if err := awaitConsole(ctx, url, 2*time.Second); err != nil {
		hint := ""
		if strings.Contains(err.Error(), "401") {
			hint = " (it is asking for a token: a machine made by an earlier release carries one in its init, so `machine down` then `machine up` makes a new one)"
		}
		if state, ok := update.ReadIs(share); ok && state.LastError != "" {
			hint += " (the service says: " + state.LastError + ")"
		}
		failing = append(failing, "the console at "+url+" did not answer"+hint+": "+err.Error())
	}
	return failing
}

// leftBehind is the sentence an uninstall and a purge both print: the mount is the person's, and saying so
// is the whole difference between removing a product and removing someone's work.
func leftBehind(share string, registry control.RegistryFile) []string {
	lines := []string{"left " + share + ": your workspaces, conversations and files are in it"}
	for _, workspace := range registry.Workspaces {
		if !strings.HasPrefix(filepath.Clean(workspace.Path), filepath.Clean(share)+string(os.PathSeparator)) && filepath.Clean(workspace.Path) != filepath.Clean(share) {
			lines = append(lines, "left "+workspace.Path+" (workspace "+workspace.Name+"): it is outside the mount and it is your own folder")
		}
	}
	return lines
}

// readRegistry is the registry the mount holds, or an empty one: an install with no registry is a machine
// that has not been booted yet, not a failure to uninstall.
func readRegistry(share string) control.RegistryFile {
	registry, err := control.LoadRegistryFile(filepath.Join(layout.New(share, "").StateDir(), "workspaces.json"))
	if err != nil {
		log.Printf("machine: cannot read the workspace registry: %v", err)
		return control.RegistryFile{}
	}
	return registry
}
