package main

// The three commands that install, remove and destroy the host service (ADR 0030, amended). Install is
// idempotent and repairs what drifted; uninstall removes what we installed and keeps what a person made;
// purge removes everything, and does nothing at all without `--yes`.

import (
	"bufio"
	"context"
	"crypto/rand"
	"encoding/hex"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"time"

	"github.com/acornfall/acornfall/gateway/internal/layout"
	"github.com/acornfall/acornfall/gateway/internal/update"
)

// machineInstall installs the host service, or repairs it: the same command, twice, is the same install.
func machineInstall(argv []string) {
	flags := flag.NewFlagSet("acornfall machine install", flag.ContinueOnError)
	root := flags.String("root", "", "the folder the machine mounts: the product (default: ~/acornfall)")
	home := flags.String("home", "", "the machinery folder (default: ~/.acornfall)")
	remote := flags.Bool("remote", false, "publish the console on 0.0.0.0, with a token (asks if neither is given)")
	local := flags.Bool("local", false, "keep the console on 127.0.0.1 (asks if neither is given)")
	port := flags.Int("port", 0, "the port the console is published on (default: the declaration's, or 7777)")
	if err := flags.Parse(argv); err != nil {
		os.Exit(2)
	}
	reachable, err := remoteAnswer(*remote, *local, stdinIsTerminal())
	if err != nil {
		log.Printf("acornfall machine install: %v", err)
		os.Exit(1)
	}
	resolvedRoot, err := resolveRoot(*root, "")
	if err != nil {
		log.Printf("acornfall machine install: %v", err)
		os.Exit(1)
	}
	resolvedHome, err := resolveDataDir(*home)
	if err != nil {
		log.Printf("acornfall machine install: %v", err)
		os.Exit(1)
	}
	where := layout.New(resolvedRoot, resolvedHome)
	if err := where.Ensure(); err != nil {
		log.Printf("acornfall machine install: %v", err)
		os.Exit(1)
	}
	if err := layout.Migrate(where, log.Printf); err != nil {
		log.Printf("machine install: moving the old layout: %v", err)
	}
	declaration := update.ReadDeclaration(resolvedRoot)
	host, declaredPort := declaration.Address()
	if *port > 0 {
		declaredPort = *port
	}
	if reachable {
		host = "0.0.0.0"
	}
	declaration.Wanted = update.IntentRunning
	declaration.Host, declaration.Port = host, declaredPort
	if reachable {
		// A console on a network address with no authentication is a shell anyone on that network can use,
		// so a token that cannot be written refuses the install rather than falling back to an open port.
		created, err := ensureToken(resolvedRoot)
		if err != nil {
			log.Printf("acornfall machine install: refusing a remote install: %v", err)
			os.Exit(1)
		}
		if created {
			line(os.Stdout)("fixed", "the token at "+filepath.Join(resolvedRoot, "config", "token")+", which the console now asks for")
		}
	}
	executable, err := os.Executable()
	if err != nil {
		log.Printf("acornfall machine install: %v", err)
		os.Exit(1)
	}
	binary, err := os.ReadFile(executable)
	if err != nil {
		log.Printf("acornfall machine install: the running binary cannot be read: %v", err)
		os.Exit(1)
	}
	version := update.BuildVersion
	if version == "" {
		version = "dev"
	}
	install := installer{
		userHome:    userHomeDir(),
		home:        resolvedHome,
		root:        resolvedRoot,
		version:     version,
		declaration: declaration,
		binary:      binary,
		init:        initFor(runtime.GOOS),
		kvm:         kvmCheck,
		machine:     driverMachine{home: resolvedHome, root: resolvedRoot, port: declaredPort, host: host, token: tokenOf(resolvedRoot)},
	}
	install.verify = func(ctx context.Context, cfg unitConfig) error {
		return verifyUp(ctx, install.init, resolvedRoot, cfg, time.Sleep)
	}
	say := line(os.Stdout)
	if err := install.run(context.Background(), func(ok bool, sentence string) {
		state := "fixed"
		if ok {
			state = "ok"
		}
		say(state, sentence)
	}); err != nil {
		log.Printf("acornfall machine install: %v", err)
		os.Exit(1)
	}
	token := ""
	if reachable {
		token = tokenOf(resolvedRoot)
	}
	for _, sentence := range installClosing(host, declaredPort, token, filepath.Join(resolvedRoot, "config", "token")) {
		say("", sentence)
	}
}

// tokenOf is the console's token when the install has one, and empty on loopback.
func tokenOf(root string) string {
	contents, err := os.ReadFile(filepath.Join(root, "config", "token"))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(contents))
}

// line prints one item of an install or a removal: a state column, then the sentence.
func line(out *os.File) func(kind, sentence string) {
	return func(kind, sentence string) {
		if kind == "" {
			fmt.Fprintln(out, sentence)
			return
		}
		fmt.Fprintf(out, "%-7s %s\n", kind, sentence)
	}
}

func stdinIsTerminal() bool {
	info, err := os.Stdin.Stat()
	return err == nil && info.Mode()&os.ModeCharDevice != 0
}

// remoteAnswer is the one question an install asks, and the flags that skip it. No terminal and no flag is a
// refusal naming both flags: guessing a network bind is guessing a console open to the network.
func remoteAnswer(remote, local, terminal bool) (bool, error) {
	switch {
	case remote && local:
		return false, errors.New("--remote and --local are opposite answers: pick one")
	case remote:
		return true, nil
	case local:
		return false, nil
	case !terminal:
		return false, errors.New("no terminal to ask whether this machine is reached from another computer: pass --local or --remote")
	}
	fmt.Println("Is this machine reached from another computer? [y/N]")
	fmt.Println("  y: the console is published on 0.0.0.0 and asks for a token")
	fmt.Println("  n: the console stays on 127.0.0.1")
	answer, err := bufio.NewReader(os.Stdin).ReadString('\n')
	if err != nil && !errors.Is(err, os.ErrClosed) && answer == "" {
		return false, fmt.Errorf("reading the answer: %w", err)
	}
	switch strings.ToLower(strings.TrimSpace(answer)) {
	case "y", "yes":
		return true, nil
	default:
		return false, nil
	}
}

// ensureToken makes the console's token exist and be a token: 32 random bytes as hex, readable by its owner
// only. It says whether it made one.
func ensureToken(root string) (bool, error) {
	path := filepath.Join(root, "config", "token")
	if contents, err := os.ReadFile(path); err == nil && strings.TrimSpace(string(contents)) != "" {
		return false, nil
	}
	raw := make([]byte, 32)
	if _, err := rand.Read(raw); err != nil {
		return false, fmt.Errorf("no random bytes for a token: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return false, fmt.Errorf("cannot make room for the token at %s: %w", path, err)
	}
	if err := writeFileAtomic(path, []byte(hex.EncodeToString(raw)+"\n"), 0o600); err != nil {
		return false, fmt.Errorf("cannot write the token at %s: %w", path, err)
	}
	return true, nil
}

// uninstaller is `machine uninstall`: it stops what runs, removes what we installed, and keeps what a person
// made. The order is asserted by a test, and the last two steps are the point of it.
type uninstaller struct {
	userHome string
	home     string
	root     string
	init     initSystem
	machine  machineControl
	say      func(kind, sentence string)
}

func (u uninstaller) run(ctx context.Context) error {
	// The order is the whole of what makes this safe, and it is the reverse of what an operator does by hand:
	// 1. stop the service — a unit that keeps restarting the binary would race the removal;
	if u.init != nil {
		if err := u.init.Disable(ctx); err != nil {
			return fmt.Errorf("stopping the service: %w", err)
		}
		u.say("stopped", "the "+u.init.Name()+" service")
	}
	// 2. stop the machine — and only then is its disk ours to remove;
	if err := u.machine.Remove(ctx); err != nil {
		return fmt.Errorf("stopping the machine: %w", err)
	}
	u.say("stopped", "the machine")
	// 3. the unit file and the binaries;
	if u.init != nil {
		unitPath, _, err := u.init.Unit(unitConfig{UserHome: u.userHome, Home: u.home, Root: u.root})
		if err != nil {
			return err
		}
		if err := os.Remove(unitPath); err == nil {
			u.say("removed", "the "+u.init.Name()+" unit at "+unitPath)
		} else if !os.IsNotExist(err) {
			return fmt.Errorf("removing the unit at %s: %w", unitPath, err)
		}
		if err := u.init.Reload(ctx); err != nil {
			return err
		}
	}
	for _, path := range binaries(u.home) {
		if err := os.Remove(path); err != nil && !os.IsNotExist(err) {
			return fmt.Errorf("removing %s: %w", path, err)
		}
		u.say("removed", path)
	}
	// 4. the disk the machine ran on, and the artifacts it was made from;
	machineDir := filepath.Dir(applianceDisk(u.home))
	if err := os.RemoveAll(machineDir); err != nil {
		return fmt.Errorf("removing %s: %w", machineDir, err)
	}
	u.say("removed", "the machine's disk at "+machineDir)
	appliances := filepath.Join(u.home, "appliance")
	if err := os.RemoveAll(appliances); err != nil {
		return fmt.Errorf("removing %s: %w", appliances, err)
	}
	u.say("removed", appliances)
	// 5. our bookkeeping inside the mount: the declaration, the host's own files, the token.
	for _, path := range []string{
		update.MachineIntentPath(u.root),
		update.HostDir(u.root),
		filepath.Join(u.root, "config", "token"),
	} {
		if err := os.RemoveAll(path); err != nil {
			return fmt.Errorf("removing %s: %w", path, err)
		}
		u.say("removed", path)
	}
	// 6. what is not ours, and the line that says so.
	for _, sentence := range leftBehind(u.root, readRegistry(u.root)) {
		u.say("", sentence)
	}
	u.say("", "linger is left alone: if it was turned on, turn it off with `loginctl disable-linger "+currentUser()+"`")
	return nil
}

// binaries is every binary we put in the install's own folder: the symlink and every release kept beside it.
func binaries(home string) []string {
	paths := []string{update.OwnedBinary(home)}
	entries, err := os.ReadDir(filepath.Join(home, "bin"))
	if err != nil {
		return paths
	}
	for _, entry := range entries {
		if strings.HasPrefix(entry.Name(), "acornfall-") {
			paths = append(paths, filepath.Join(home, "bin", entry.Name()))
		}
	}
	return paths
}

// purger is `machine purge`: nothing left. It is the one command that destroys a person's work, so it does
// nothing at all without --yes, and the list it prints then is the dry run.
type purger struct {
	userHome  string
	home      string
	root      string
	yes       bool
	init      initSystem
	uninstall func(ctx context.Context) error
	say       func(kind, sentence string)
}

func (p purger) run(ctx context.Context) error {
	for _, path := range []struct{ kind, path string }{{"the machinery", p.home}, {"the mount", p.root}} {
		if err := removablePath(path.kind, path.path, p.userHome); err != nil {
			return err
		}
	}
	registry := readRegistry(p.root)
	installed := false
	for _, path := range []string{update.OwnedBinary(p.home), filepath.Join(p.root, "state", "machine.json")} {
		if _, err := os.Lstat(path); err == nil {
			installed = true
		}
	}
	if p.init != nil {
		if unitPath, _, err := p.init.Unit(unitConfig{UserHome: p.userHome, Home: p.home, Root: p.root}); err == nil {
			if _, err := os.Lstat(unitPath); err == nil {
				installed = true
			}
		}
	}
	// The whole list, with what is in each path: a person reads this before deciding.
	listed := removals(p.home, p.root)
	for _, path := range listed {
		p.say("would remove", path+" ("+sizeOf(path)+")")
	}
	for _, sentence := range leftBehind(p.root, registry) {
		p.say("", sentence)
	}
	if !p.yes {
		return fmt.Errorf("nothing removed: pass --yes to remove the %d paths above", len(listed))
	}
	if installed {
		// A purge that runs first does the uninstall, in the same run: it is the same removal, in order.
		if err := p.uninstall(ctx); err != nil {
			return err
		}
	}
	for _, path := range listed {
		if err := os.RemoveAll(path); err != nil {
			return fmt.Errorf("removing %s: %w", path, err)
		}
		p.say("removed", path)
	}
	if p.init != nil {
		if err := p.init.DisableLinger(ctx); err != nil {
			p.say("", "linger could not be turned off: "+err.Error())
		} else {
			p.say("removed", "linger, so the service does not come back at boot")
		}
	}
	for _, sentence := range leftBehind(p.root, registry) {
		p.say("", sentence)
	}
	return nil
}

// removals is every path a purge takes, in the order a person can follow: the machinery, then the mount.
func removals(home, root string) []string {
	paths := []string{
		filepath.Join(home, "bin"),
		filepath.Join(home, "tools"),
		filepath.Join(home, "machines"),
		filepath.Join(home, "appliance"),
		filepath.Join(home, "worker"),
		filepath.Join(home, "state"),
		home,
		root,
	}
	seen := make(map[string]bool, len(paths))
	kept := paths[:0]
	for _, path := range paths {
		if seen[path] || path == "" {
			continue
		}
		seen[path] = true
		kept = append(kept, path)
	}
	return kept
}

// removablePath refuses a path a purge must never remove: it is the one command that destroys work, so the
// paths are the ones it computes and never a flag's, and a path that is a symlink is refused rather than
// followed.
func removablePath(kind, path, userHome string) error {
	clean := filepath.Clean(path)
	switch {
	case clean == "/" || clean == ".":
		return fmt.Errorf("%s is %s: that is every file on this machine, and a purge removes the install only", kind, clean)
	case clean == filepath.Clean(userHome) || clean == "/root":
		return fmt.Errorf("%s is %s, a home directory itself: a purge removes the product's folders, not someone's home", kind, clean)
	case len(strings.Split(strings.Trim(clean, string(os.PathSeparator)), string(os.PathSeparator))) < 3:
		return fmt.Errorf("%s is %s, which is too close to the root of the file system: a purge removes a path with at least three components", kind, clean)
	}
	if info, err := os.Lstat(clean); err == nil && info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("%s is %s, which is a symlink: a purge refuses to follow it, because what it points at is not the install", kind, clean)
	}
	return nil
}

// sizeOf says what a path holds, so a person deciding about a purge knows what it costs: a folder is the sum
// of its files, and something that is not there is nothing.
func sizeOf(path string) string {
	var total int64
	err := filepath.Walk(path, func(_ string, info os.FileInfo, err error) error {
		if err != nil {
			return nil
		}
		if !info.IsDir() {
			total += info.Size()
		}
		return nil
	})
	if err != nil || total == 0 {
		if _, statErr := os.Lstat(path); statErr != nil {
			return "nothing to remove"
		}
	}
	return humanSize(total)
}

func humanSize(bytes int64) string {
	switch {
	case bytes >= 1<<30:
		return fmt.Sprintf("%.1f GiB", float64(bytes)/(1<<30))
	case bytes >= 1<<20:
		return fmt.Sprintf("%.1f MiB", float64(bytes)/(1<<20))
	case bytes >= 1<<10:
		return fmt.Sprintf("%.0f KiB", float64(bytes)/(1<<10))
	default:
		return fmt.Sprintf("%d B", bytes)
	}
}

// uninstallFlags is the command's whole surface: two folders and no word for deleting the mount. A flag that
// removed a person's work would be the one mistake this command cannot make twice.
func uninstallFlags() (*flag.FlagSet, *string, *string) {
	flags := flag.NewFlagSet("acornfall machine uninstall", flag.ContinueOnError)
	root := flags.String("root", "", "the folder the machine mounts (default: ~/acornfall)")
	home := flags.String("home", "", "the machinery folder (default: ~/.acornfall)")
	return flags, root, home
}

// machineUninstall removes the product and keeps the person's work.
func machineUninstall(argv []string) {
	flags, root, home := uninstallFlags()
	if err := flags.Parse(argv); err != nil {
		os.Exit(2)
	}
	resolvedRoot, err := resolveRoot(*root, "")
	if err != nil {
		log.Printf("acornfall machine uninstall: %v", err)
		os.Exit(1)
	}
	resolvedHome, err := resolveDataDir(*home)
	if err != nil {
		log.Printf("acornfall machine uninstall: %v", err)
		os.Exit(1)
	}
	remove := uninstaller{
		userHome: userHomeDir(),
		home:     resolvedHome,
		root:     resolvedRoot,
		init:     initFor(runtime.GOOS),
		machine:  driverMachine{home: resolvedHome, root: resolvedRoot},
		say:      line(os.Stdout),
	}
	if err := remove.run(context.Background()); err != nil {
		log.Printf("acornfall machine uninstall: %v", err)
		os.Exit(1)
	}
}

// machinePurge removes everything, and refuses to do it without --yes.
func machinePurge(argv []string) {
	flags := flag.NewFlagSet("acornfall machine purge", flag.ContinueOnError)
	root := flags.String("root", "", "the folder the machine mounts (default: ~/acornfall)")
	home := flags.String("home", "", "the machinery folder (default: ~/.acornfall)")
	yes := flags.Bool("yes", false, "remove everything listed; without it nothing is removed and the list is the dry run")
	if err := flags.Parse(argv); err != nil {
		os.Exit(2)
	}
	resolvedRoot, err := resolveRoot(*root, "")
	if err != nil {
		log.Printf("acornfall machine purge: %v", err)
		os.Exit(1)
	}
	resolvedHome, err := resolveDataDir(*home)
	if err != nil {
		log.Printf("acornfall machine purge: %v", err)
		os.Exit(1)
	}
	remove := uninstaller{
		userHome: userHomeDir(),
		home:     resolvedHome,
		root:     resolvedRoot,
		init:     initFor(runtime.GOOS),
		machine:  driverMachine{home: resolvedHome, root: resolvedRoot},
		say:      line(os.Stdout),
	}
	purge := purger{
		userHome:  userHomeDir(),
		home:      resolvedHome,
		root:      resolvedRoot,
		yes:       *yes,
		init:      initFor(runtime.GOOS),
		uninstall: remove.run,
		say:       line(os.Stdout),
	}
	if err := purge.run(context.Background()); err != nil {
		log.Printf("acornfall machine purge: %v", err)
		os.Exit(1)
	}
}
