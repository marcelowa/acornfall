package main

// Installing and removing the host service (ADR 0030, amended). `machine install` puts the product where
// it belongs and repairs what drifted; `machine uninstall` removes what we installed and keeps what a
// person made; `machine purge` removes everything, and refuses to do it without `--yes`. The unit files
// are generated from a copy embedded in the binary: nobody edits a unit by hand, and no install can
// disagree with the declaration the commands read.

import (
	"context"
	_ "embed"
	"fmt"
	"log"
	"net"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
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
	UserHome string
	Home     string
	Root     string
	Host     string
	Port     int
}

// unitFor renders the unit this platform's init reads and says where it goes. Anything else is refused by
// name: there is no unit to write, and guessing one is how an install half-happens.
func unitFor(goos string, cfg unitConfig) (path, content string, err error) {
	unit := strings.NewReplacer(
		"{{BINARY}}", update.OwnedBinary(cfg.Home),
		"{{ROOT}}", cfg.Root,
		"{{HOME}}", cfg.Home,
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
	if home, err := os.UserHomeDir(); err == nil {
		return home
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
	home        string
	root        string
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
		UserHome: in.userHome,
		Home:     in.home,
		Root:     in.root,
		Host:     in.declaration.Host,
		Port:     in.declaration.Port,
	}
	if cfg.Host == "" {
		cfg.Host, cfg.Port = in.declaration.Address()
	}
	previous := update.ReadDeclaration(in.root)
	previousHost, previousPort := previous.Address()
	addressChanged := previousHost != cfg.Host || previousPort != cfg.Port

	// The binary, under the release's own name, and the symlink the unit starts.
	versioned := update.VersionedBinary(in.home, in.version)
	written, err := writeIfDifferent(versioned, in.binary, 0o755)
	if err != nil {
		return fmt.Errorf("putting the binary at %s: %w", versioned, err)
	}
	if err := checkExecutable(versioned, len(in.binary)); err != nil {
		return err
	}
	say(!written, "the binary at "+versioned)
	linked, err := pointIfDifferent(update.OwnedBinary(in.home), versioned)
	if err != nil {
		return fmt.Errorf("pointing %s at %s: %w", update.OwnedBinary(in.home), versioned, err)
	}
	say(!linked, "the symlink at "+update.OwnedBinary(in.home))

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
		if err := update.WriteDeclaration(in.root, in.declaration); err != nil {
			return fmt.Errorf("writing the declaration: %w", err)
		}
	}
	say(!declarationWritten, "the declaration at "+update.MachineIntentPath(in.root))
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
	if unitWritten || addressChanged {
		// The unit is what starts it and the address is read at start-up: a service that is already running
		// would go on publishing the old one until something restarted it.
		if err := in.init.Restart(ctx); err != nil {
			return err
		}
		say(false, "restarted the service, so it publishes what the unit says")
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

	// A machine's address is fixed when it is created, so a machine that is running on the old one is taken
	// away: the service makes it again on the new address, and says nothing when it was not running.
	if addressChanged && in.machine != nil {
		if running, err := in.machine.Running(ctx); err == nil && running {
			if err := in.machine.Remove(ctx); err != nil {
				return fmt.Errorf("recreating the machine on its new address: %w", err)
			}
			say(false, "recreated the machine, which was running on the old address")
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

// verifyUp is the real check after an install: the unit is active, the state the console reads has been
// written, and the console answers on the declared address.
func verifyUp(ctx context.Context, init initSystem, root string, cfg unitConfig, sleep func(time.Duration)) error {
	url := consoleURL(cfg.Host, cfg.Port)
	deadline := time.Now().Add(20 * time.Second)
	for {
		if init.Active(ctx) {
			if _, ok := update.ReadIs(root); ok {
				if awaitConsole(ctx, url, 2*time.Second) == nil {
					return nil
				}
			}
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("the service is not up: %s %s, %s, or the console at %s did not answer in 20s", init.Name(), "unit not active", update.IsPath(root), url)
		}
		sleep(time.Second)
	}
}

// leftBehind is the sentence an uninstall and a purge both print: the mount is the person's, and saying so
// is the whole difference between removing a product and removing someone's work.
func leftBehind(root string, registry control.RegistryFile) []string {
	lines := []string{"left " + root + ": your workspaces, conversations and files are in it"}
	for _, workspace := range registry.Workspaces {
		if !strings.HasPrefix(filepath.Clean(workspace.Path), filepath.Clean(root)+string(os.PathSeparator)) && filepath.Clean(workspace.Path) != filepath.Clean(root) {
			lines = append(lines, "left "+workspace.Path+" (workspace "+workspace.Name+"): it is outside the mount and it is your own folder")
		}
	}
	return lines
}

// readRegistry is the registry the mount holds, or an empty one: an install with no registry is a machine
// that has not been booted yet, not a failure to uninstall.
func readRegistry(root string) control.RegistryFile {
	registry, err := control.LoadRegistryFile(filepath.Join(layout.New(root, "").StateDir(), "workspaces.json"))
	if err != nil {
		log.Printf("machine: cannot read the workspace registry: %v", err)
		return control.RegistryFile{}
	}
	return registry
}
