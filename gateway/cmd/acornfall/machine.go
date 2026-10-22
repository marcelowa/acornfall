package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"io"
	"log"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/acornfall/acornfall/gateway/internal/httpapi"
	"github.com/acornfall/acornfall/gateway/internal/layout"
	"github.com/acornfall/acornfall/gateway/internal/sandbox"
	"github.com/acornfall/acornfall/gateway/internal/update"
)

// machineCommand is the host's side of ADR 0022: the host is a launcher, and the product is a
// machine. It boots the one machine — whose init is the appliance itself, with the mount as its
// world — and tells a person where the console is. Nothing of the product runs here.
func machineCommand(argv []string) {
	if len(argv) == 0 {
		machineUsage()
		return
	}
	switch argv[0] {
	case "up":
		machineUp(argv[1:])
	case "status":
		machineStatus(argv[1:])
	case "stop":
		machineStop(argv[1:])
	case "down":
		machineDown(argv[1:])
	case "serve":
		machineServe(argv[1:])
	case "install":
		machineInstall(argv[1:])
	case "uninstall":
		machineUninstall(argv[1:])
	case "purge":
		machinePurge(argv[1:])
	case "update":
		machineUpdate(argv[1:])
	case "restart":
		// A restart is what a person reaches for when the machine is not behaving; it is a down and
		// an up, with the same flags, because everything the product needs is in the mount.
		if err := restartMachine(argv[1:], takeMachineDown, machineUp); err != nil {
			log.Printf("acornfall machine: %v", err)
			os.Exit(1)
		}
	default:
		machineUsage()
	}
}

func machineUsage() {
	fmt.Fprint(os.Stderr, `acornfall machine: the one machine an install runs in.

  acornfall machine up       boot it, and say where the console is
  acornfall machine status   whether it is there and running
  acornfall machine down     take it away; the mount and the appliance tarball stay
  acornfall machine restart  down, then up — what a person reaches for
  acornfall machine serve    keep it running, and apply the release the product asks for
  acornfall machine update   update the machine and then the host, now, without waiting
  acornfall machine install  install the service, or repair it: safe to run twice
  acornfall machine uninstall remove the product; your workspaces and the mount stay
  acornfall machine purge    remove everything, with --yes: this deletes your workspaces

The machine runs the appliance: the gateway and the worker inside it, with ~/acornfall mounted
as the product (config, state, workspaces). Nothing of the product runs on the host.

serve is the host service (docs/adr/0030): it starts the machine at boot, restarts it when it
exits, and applies the release the product declares in state/host/want.json. Run it under systemd
or launchd (scripts/units/), not from a terminal you will close.
`)
}

// machineUp boots the machine and waits for its console. Running it again is not a second
// machine: the engine finds the one this install has and leaves it alone.
func machineUp(argv []string) {
	flags := flag.NewFlagSet("acornfall machine up", flag.ContinueOnError)
	root := flags.String("root", "", "the folder the machine mounts: the product (default: ~/acornfall)")
	home := flags.String("home", "", "the machinery folder (default: ~/.acornfall)")
	image := flags.String("image", "", applianceImageHelp)
	tag := flags.String("tag", "", "the release to fetch the appliance from (default: this build's version)")
	refresh := flags.Bool("refresh", false, "fetch the appliance again and recreate the machine: an init is fixed at boot, so an update is a new machine")
	port := flags.Int("port", 7777, "the host port the console is published on")
	// Loopback by default because the appliance runs with --insecure: a console with no
	// authentication on a network address is a shell anyone on that network can use.
	host := flags.String("host", "127.0.0.1", "the host address the console is published on (0.0.0.0 exposes an unauthenticated console)")
	cpus := flags.Int("cpus", 2, "virtual cpus for the machine")
	memory := flags.String("memory", "4G", "memory for the machine")
	wait := flags.Duration("wait", 3*time.Minute, "how long to wait for the console; zero does not wait")
	if err := flags.Parse(argv); err != nil {
		os.Exit(2)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()

	resolvedRoot, err := resolveRoot(*root, "")
	if err != nil {
		log.Fatalf("acornfall machine: %v", err)
	}
	resolvedHome, err := resolveDataDir(*home)
	if err != nil {
		log.Fatalf("acornfall machine: %v", err)
	}
	// What the machine boots: a directory a person named, or the disk this install makes from the
	// release's tarball (ADR 0026, amended). It is decided before the engine is wired, because the
	// image is part of the machine's own configuration.
	plan := applianceLayoutFor(resolvedHome, applianceTag(*tag), *refresh)
	if *image != "" {
		plan = applianceLayout{Image: *image}
	}
	resolvedImage := plan.Image
	// The person asked for a running machine, and it is recorded before anything that can fail: a
	// boot interrupted half way must leave the intent, or the service would leave the machine down
	// because it never heard what the person wanted (ADR 0030, amended).
	if err := declareMachine(resolvedRoot, update.IntentRunning); err != nil {
		log.Fatalf("acornfall machine: %v", err)
	}
	// The mount is the product, so it has to be there before the machine is: the machine mounts
	// it, and a machine whose world is missing boots into a console with no workspaces.
	where := layout.New(resolvedRoot, resolvedHome)
	if err := where.Ensure(); err != nil {
		log.Fatalf("acornfall machine: %v", err)
	}
	// An install from before the layout moved kept its key in the machinery folder; the machine
	// reads the mount. Moving it here is what makes "it worked, but the workspace has no key" a
	// thing of the past — the move the gateway does at boot, done for the host's own folder.
	if err := layout.Migrate(where, log.Printf); err != nil {
		log.Printf("machine: moving the old layout: %v", err)
	}
	// The token, when the install has one, comes from the mount: the appliance has no secrets of
	// its own, and a port that answers without one is only safe while it is loopback.
	// The address is the declaration's: a flag that was given wrote it, and a flag that was not reads it.
	*host, *port, err = declaredAddress(resolvedRoot, flags, host, port)
	if err != nil {
		log.Fatalf("acornfall machine: %v", err)
	}
	build := func(image string) (*sandbox.LXC, error) {
		return machineDriver(resolvedHome, image, resolvedRoot, *cpus, *memory, *port, *host, applianceInit(resolvedRoot))
	}
	driver, err := build(resolvedImage)
	if err != nil {
		log.Fatalf("acornfall machine: %v", err)
	}
	engine := driver.Engine()
	if err := engine.Install(ctx, log.Printf); err != nil {
		log.Fatalf("acornfall machine: %v", err)
	}
	switch {
	case *image != "":
		// A named directory is the person's own tree: compared with nothing, fetched into only when
		// it is not an appliance at all, and cleaned of a previous machine's containers when a
		// refresh asks. Nothing here decides anything about releases.
		if applianceWillReplace(resolvedImage, applianceTag(*tag), *refresh, true) {
			if err := driver.RemoveMachine(ctx); err != nil {
				log.Fatalf("acornfall machine: removing the old machine: %v", err)
			}
		}
		if err := ensureAppliance(ctx, resolvedHome, resolvedImage, *refresh, true, *tag); err != nil {
			log.Fatalf("acornfall machine: %v", err)
		}
		if *refresh {
			// A refresh asked for an image without the containers a previous machine left on it.
			// After a fetch there are none; after a fetch that could not happen, this is the
			// cleaning.
			if err := os.RemoveAll(filepath.Join(resolvedImage, "var", "lib", "lxc")); err != nil {
				log.Fatalf("acornfall machine: cleaning the image's containers: %v", err)
			}
		}
	case plan.Legacy:
		// An install from before the artifact was kept boots the directory it has, exactly as it
		// did. This change never deletes it and never writes into it (ADR 0026, amended).
		log.Printf("machine: booting the appliance this install already has (%s, %s)", resolvedImage, applianceDescribe(resolvedImage))
	case plan.Unpack:
		if applianceTag(*tag) == "" {
			log.Fatalf("acornfall machine: this build does not know its own version, so it cannot say which release the appliance comes from: pass --tag, or --image for your own tree")
		}
		// The disk is the machine: it is taken away *before* the tree under it changes — a running
		// machine reading a disk that is being replaced is the shape of corruption nobody could
		// diagnose — and the product is in the mount, so nothing of it is lost.
		if err := driver.RemoveMachine(ctx); err != nil {
			log.Fatalf("acornfall machine: removing the old machine: %v", err)
		}
		resolvedImage, err = makeApplianceDisk(ctx, resolvedHome, resolvedRoot, applianceTag(*tag), plan, *refresh)
		if err != nil {
			log.Fatalf("acornfall machine: %v", err)
		}
		if resolvedImage != plan.Image {
			// A fetch that could not happen boots what is here, and that is another directory.
			if driver, err = build(resolvedImage); err != nil {
				log.Fatalf("acornfall machine: %v", err)
			}
		}
	}

	log.Printf("machine: booting the appliance from %s", resolvedImage)
	if err := driver.EnsureMachine(ctx); err != nil {
		log.Fatalf("acornfall machine: %v", err)
	}
	url := consoleURL(*host, *port)
	if notice := publishNotice(*host, *port); notice != "" {
		fmt.Fprint(os.Stderr, notice)
	}
	log.Printf("machine: the console is %s", url)
	if *wait <= 0 {
		return
	}
	if err := awaitConsole(ctx, url, *wait); err != nil {
		log.Fatalf("acornfall machine: %v", err)
	}
	log.Printf("machine: the appliance is serving on %s", url)
}

// consoleURL is the address a browser can open. "Every interface" is not an address, so the
// wildcard becomes loopback; and an IPv6 literal needs its brackets, or the URL names a port that
// does not exist.
func consoleURL(host string, port int) string {
	browsable := host
	if browsable == "" || browsable == "0.0.0.0" || browsable == "::" {
		browsable = "127.0.0.1"
	}
	return "http://" + net.JoinHostPort(browsable, strconv.Itoa(port))
}

// publishNotice is the one line a person reads when the console is not on loopback, and nothing
// when it is. It names host and port, because "0.0.0.0" alone is not somewhere anyone can go; and
// it says which of the two authentication situations the install is in, because a notice that says
// "no authentication" over an install that carries a token is a notice people learn to skip.
//
// Not an error: a lab VM or a tailnet is a real place to want this. Saying it once, with the
// address it is actually on, is cheaper than the surprise of finding the console open to a network
// later.
func publishNotice(host string, port int) string {
	if httpapi.IsLoopback(host) {
		return ""
	}
	// One line, once: a console on a network address is reachable by whoever can route to it, and that is
	// a decision a person should read rather than discover.
	return fmt.Sprintf("machine: publishing on %s:%d, and the console has no authentication\n", host, port)
}

// machineStatus reports whether the machine is there, without making anything: asking a machine
// how it is must not be the thing that creates it.
func machineStatus(argv []string) {
	flags := flag.NewFlagSet("acornfall machine status", flag.ContinueOnError)
	home := flags.String("home", "", "the machinery folder (default: ~/.acornfall)")
	root := flags.String("root", "", "the folder the machine mounts (default: ~/acornfall)")
	image := flags.String("image", "", applianceImageHelp)
	if err := flags.Parse(argv); err != nil {
		os.Exit(2)
	}
	resolvedHome, err := resolveDataDir(*home)
	if err != nil {
		log.Fatalf("acornfall machine: %v", err)
	}
	resolvedRoot, err := resolveRoot(*root, "")
	if err != nil {
		log.Fatalf("acornfall machine: %v", err)
	}
	resolvedImage := *image
	if resolvedImage == "" {
		resolvedImage = applianceLayoutFor(resolvedHome, applianceTag(""), false).Image
	}
	driver, err := machineDriver(resolvedHome, resolvedImage, resolvedRoot, 2, "4G", 7777, "127.0.0.1", applianceInit(resolvedRoot))
	if err != nil {
		log.Fatalf("acornfall machine: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	fmt.Println(statusAddress(resolvedRoot))
	name := driver.MachineName()
	if !driver.Engine().Installed() {
		// Asking how the machine is must not install anything: a machine that was never booted
		// here has no engine, which is the same answer as no machine.
		fmt.Printf("%s: not made yet (acornfall machine up boots it; the sandbox engine is not installed)\n", name)
		return
	}
	instances, err := driver.Engine().List(ctx)
	if err != nil {
		log.Fatalf("acornfall machine: %v", err)
	}
	for _, instance := range instances {
		if instance.Name != name {
			continue
		}
		state := "stopped"
		if instance.Running() {
			state = "running"
		}
		fmt.Printf("%s: %s\n", name, state)
		return
	}
	fmt.Printf("%s: not made yet (acornfall machine up boots it)\n", name)
}

// machineDriver is the engine plus the machine the appliance runs in. The door is not used by
// the appliance's own gateway — it is in the machine, and its containers are its neighbours —
// but the machine's configuration still carries it, because the host may need the same door for
// the engine that reaches containers from outside (internal/sandbox/lxcengine.go).
func machineDriver(home, image, root string, cpus int, memory string, port int, host string, start string) (*sandbox.LXC, error) {
	binary, err := os.Executable()
	if err != nil {
		return nil, fmt.Errorf("this binary's own path is what the machine runs the shim from: %w", err)
	}
	engine := sandbox.NewMicrosandbox(home)
	machine := sandbox.Machine{
		Image:     image,
		CPUs:      cpus,
		Memory:    memory,
		ShareRoot: root,
	}
	driver := sandbox.NewLXC(engine, machine, filepath.Join(home, "state", "machine.sock"), binary)
	driver = driver.WithAppliance(start, fmt.Sprintf("%s:%d:7777", host, port))
	return driver, nil
}

// applianceInit is what the machine runs as its init: the product, out of the image, with the
// mount as its world. There is no provider flag and no model flag here — they come from the
// mount, which is the point of the layout (ADR 0022): the machine holds nothing of the
// product's, so it can be replaced without losing any. The token, when there is one, comes from
// the mount for the same reason; without one the port is only published on loopback.
func applianceInit(root string) string {
	machineHome := "/var/lib/acornfall"
	workspace := filepath.Join(root, "workspaces", "general")
	// No token: the console asks for nothing, which is the default everywhere (MVP). A launcher that
	// published on a network address said so once, at the address it chose.
	auth := "--insecure"
	return strings.Join([]string{
		// The machine's init is started by the engine, and its environment is the engine's, not a login's:
		// PATH arrives without /usr/sbin, where iptables and sysctl live on Debian. The shim gives the
		// containers their way out with iptables, so a machine without it in PATH has containers that cannot
		// start — measured: `exec: "iptables": executable file not found in $PATH`, which reads like a missing
		// package and is a missing directory in a variable.
		"PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin; export PATH;",
		// The image is a tarball of files, links and directories: device nodes are the kernel's to
		// make, and an unpacker run as a user cannot create them. A machine whose /dev is empty
		// cannot attach to a container at all (measured: "open_devnull: Operation not permitted"),
		// so the init makes the few nodes a container runtime needs before anything else exists.
		"for d in null:1:3 zero:1:5 full:1:7 random:1:8 urandom:1:9 tty:5:0; do",
		"  n=${d%%:*}; rest=${d#*:}; ma=${rest%%:*}; mi=${rest#*:};",
		"  [ -e /dev/$n ] || mknod -m 666 /dev/$n c $ma $mi || true;",
		"done;",
		"[ -d /dev/pts ] || mkdir -p /dev/pts; [ -d /dev/shm ] || mkdir -p /dev/shm;",
		// Everything the appliance says goes to a file inside the machine: it is the only place a
		// container that failed to start explains itself, and the console is not readable.
		"exec /usr/local/bin/acornfall",
		"--addr 0.0.0.0:7777 " + auth,
		"--root " + root,
		"--home " + machineHome,
		"--workspace " + workspace,
		"--worker-dir /usr/local/lib/acornfall/worker",
		"--sandbox-engine lxc --in-machine",
		">>" + filepath.Join(machineHome, "appliance.log") + " 2>&1",
	}, " ")
}

// ensureAppliance makes sure the machine's rootfs is the release this build runs: it fetches the
// release's appliance, verified against the release's own checksums, and records which release the
// image now is.
//
// Existence was the whole test until an upgrade left the old image in place — and with it the
// containers a previous machine had accumulated. A container the runtime could not read then
// disabled the tools of every workspace on the new machine, and the only cure was a clean install,
// because nothing in `machine up` ever replaced a byte. What an image claims to be is the mark the
// build writes into it, and the launcher stamps that mark when it fetches a release: it verified
// the tarball's checksum, so it knows which release those bytes are.
//
// The caller takes the machine away first (applianceWillReplace): the image is its disk.
func ensureAppliance(ctx context.Context, home, image string, refresh, given bool, tag string) error {
	tag = applianceTag(tag)
	if !applianceWillReplace(image, tag, refresh, given) {
		return nil
	}
	existed := checkAppliance(image) == nil
	if tag == "" {
		return fmt.Errorf("this build does not know its own version, so it cannot say which release the appliance comes from: pass --image or --tag")
	}
	if existed {
		log.Printf("machine: the image is %s and this build runs %s: fetching the release's", applianceDescribe(image), tag)
	}
	log.Printf("machine: fetching the appliance %s into %s", tag, image)
	if err := fetchAppliance(ctx, home, tag, image); err != nil {
		if refresh || !existed {
			return err
		}
		// An install that is offline keeps the machine it has. The image is the wrong release and
		// says so here, which is a sentence; refusing to boot would be an install that cannot start
		// because GitHub was unreachable.
		log.Printf("machine: cannot fetch %s (%v): booting the image that is there, which does not say which release it is", tag, err)
		return nil
	}
	return stampAppliance(image, tag)
}

// applianceWillReplace says whether the image has to be fetched: a refresh, an image that is not
// an appliance, or one that is not the release this build runs. A named image is the person's own
// tree and a source build has no release to be, so neither is replaced.
func applianceWillReplace(image, tag string, refresh, given bool) bool {
	return refresh || checkAppliance(image) != nil || !applianceCurrent(image, tag, given)
}

// applianceTag is the release this launcher runs, or the one it was told.
func applianceTag(tag string) string {
	if tag != "" {
		return tag
	}
	return update.BuildVersion
}

// updateSteps is the whole two-step update without the flags (ADR 0031). The order is the safety: the
// machine first, its readiness second, the host's own binary last — so a release that breaks the machine
// leaves the host that can repair it. `machine update` is this function with a lock around it.
func updateSteps(ctx context.Context, tag string, machineOnly bool, step1 func(context.Context, string) error, ready func(context.Context, string) bool, step2 func(context.Context, string) error) error {
	if err := step1(ctx, tag); err != nil {
		return fmt.Errorf("step 1 (the machine): %w", err)
	}
	if machineOnly {
		return nil
	}
	if !ready(ctx, tag) {
		return fmt.Errorf("step 1 (the machine) did not prove %s: its state never reported a worker ready, so step 2 (the host) was not taken", tag)
	}
	if err := step2(ctx, tag); err != nil {
		return fmt.Errorf("step 2 (the host): %w", err)
	}
	return nil
}

// updateUnderLock runs one update with the host's lock held, and returns only after the lock is gone.
// Every way an update can fail comes back as an error and the process exits once, here: an exit inside
// would skip the deferred release, and a lock left by a process that is gone is the next update's
// problem (ADR 0031).
func updateUnderLock(root string, run func() (string, error)) (string, error) {
	unlock, note, err := update.AcquireLock(root, time.Now())
	if err != nil {
		return "", err
	}
	defer unlock()
	if note != "" {
		log.Printf("%s: %s", commandName, note)
	}
	return run()
}

// machineUpdateRun is `machine update` between its flags and the two steps. It declares the machine
// running before step 1 — the same write `machine up` does — because a person typing the command is the
// declaration, and a command cannot be kept by the gate that guards the service's automatic applies. Its
// parts are arguments so a test drives that without a hypervisor.
func machineUpdateRun(ctx context.Context, root string, resolve func() (string, error), machineOnly bool, step1 func(context.Context, string) error, ready func(context.Context, string) bool, step2 func(context.Context, string) error) (string, error) {
	if err := update.WriteMachineIntent(root, update.IntentRunning); err != nil {
		return "", fmt.Errorf("recording that a person asked for a running machine: %w", err)
	}
	tag, err := resolve()
	if err != nil {
		return "", err
	}
	return tag, updateSteps(ctx, tag, machineOnly, step1, ready, step2)
}

// machineUpdate runs the update now, in both steps (ADR 0031).
// It holds the same lock the service's automatic step two takes, so two updates never write the same
// binary or the same disk.
func machineUpdate(argv []string) {
	flags := flag.NewFlagSet("acornfall machine update", flag.ContinueOnError)
	root := flags.String("root", "", "the folder the machine mounts: the product (default: ~/acornfall)")
	home := flags.String("home", "", "the machinery folder (default: ~/.acornfall)")
	tag := flags.String("tag", "", "the release to update to (default: the newest one)")
	machineOnly := flags.Bool("machine-only", false, "do step 1 and stop: the machine moves, the host keeps the binary it has")
	port := flags.Int("port", 7777, "the host port the console is published on")
	host := flags.String("host", "127.0.0.1", "the host address the console is published on")
	cpus := flags.Int("cpus", 2, "virtual cpus for the machine")
	memory := flags.String("memory", "4G", "memory for the machine")
	wait := flags.Duration("wait", 3*time.Minute, "how long step 1's console has to answer before step 2 is not taken")
	if err := flags.Parse(argv); err != nil {
		os.Exit(2)
	}
	resolvedRoot, err := resolveRoot(*root, "")
	if err != nil {
		log.Fatalf("acornfall machine update: %v", err)
	}
	resolvedHome, err := resolveDataDir(*home)
	if err != nil {
		log.Fatalf("acornfall machine update: %v", err)
	}
	where := layout.New(resolvedRoot, resolvedHome)
	if err := where.Ensure(); err != nil {
		log.Fatalf("acornfall machine update: %v", err)
	}
	if err := layout.Migrate(where, log.Printf); err != nil {
		log.Printf("machine update: moving the old layout: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Minute)
	defer cancel()
	if err := sandbox.NewMicrosandbox(resolvedHome).Install(ctx, log.Printf); err != nil {
		log.Fatalf("acornfall machine update: %v", err)
	}
	executable, err := os.Executable()
	if err != nil {
		log.Fatalf("acornfall machine update: %v", err)
	}
	manager := update.New(resolvedHome, resolvedRoot, "", "")
	resolve := func() (string, error) {
		var releases []update.Release
		if strings.TrimSpace(*tag) == "" {
			// The release list, not `/releases/latest`: GitHub's latest excludes pre-releases, and this
			// project ships nothing else — a command whose job is "update me" cannot read an answer
			// that never names the release it should move to (ADR 0031).
			list, err := manager.List(ctx, update.MaxListLimit, true)
			if err != nil {
				return "", fmt.Errorf("cannot read the release list: %w", err)
			}
			releases = list
		}
		return update.UpdateTarget(strings.TrimSpace(*tag), releases, applianceRunningVersion(resolvedHome))
	}
	*host, *port, err = declaredAddress(resolvedRoot, flags, host, port)
	if err != nil {
		log.Printf("acornfall machine update: %v", err)
		os.Exit(1)
	}
	machine := driverMachine{
		home:   resolvedHome,
		root:   resolvedRoot,
		cpus:   *cpus,
		memory: *memory,
		port:   *port,
		host:   *host,
	}
	step1 := func(ctx context.Context, tag string) error {
		// No gate: a person typed this command, so it is the declaration. The service's gate would
		// otherwise refuse the person's own command for not being declared by a person.
		_, err := applyRelease(ctx, resolvedHome, machine, tag, nil, commandName)
		return err
	}
	ready := func(ctx context.Context, tag string) bool {
		return awaitReady(ctx, consoleURL(*host, *port), *wait) == nil
	}
	step2 := func(ctx context.Context, tag string) error {
		if !update.OwnsSelf(executable, resolvedHome) {
			return fmt.Errorf("this binary is not %s, and the host will not write one it did not put there", update.OwnedBinary(resolvedHome))
		}
		binary, err := manager.DownloadSelf(ctx, tag)
		if err != nil {
			return err
		}
		return update.SwapSelf(resolvedHome, resolvedRoot, tag, binary)
	}
	// The lock is released before this function returns, and the one exit below happens after it: a
	// `log.Fatalf` here would run no deferred unlock and leave the lock behind with a dead pid, which is
	// what the next update then had to break (ADR 0031).
	releaseTag, err := updateUnderLock(resolvedRoot, func() (string, error) {
		return machineUpdateRun(ctx, resolvedRoot, resolve, *machineOnly, step1, ready, step2)
	})
	if err != nil {
		log.Printf("acornfall machine update: %v", err)
		os.Exit(1)
	}
	if *machineOnly {
		log.Printf("machine update: the machine runs %s; --machine-only, so the host keeps %s", releaseTag, update.BuildVersion)
		return
	}
	log.Printf("machine update: the machine runs %s and the host's binary is %s; restart the service (systemctl --user restart acornfall-machine, or launchctl kickstart) so it runs it", releaseTag, update.VersionedBinary(resolvedHome, releaseTag))
}

// statusAddress is what `machine status` says about where the console is: a person asking "where do I
// browse" gets an answer without opening a browser, and it is the declaration's address rather than a flag's.
func statusAddress(root string) string {
	host, port := update.ReadDeclaration(root).Address()
	return "console: " + consoleURL(host, port)
}

// declaredAddress is the address the console is published on: the declaration's, which the flags write when
// they are given. The machine's address is fixed when it is created, so one file says what it is and no two
// processes can disagree about it (ADR 0030, amended).
func declaredAddress(root string, flags *flag.FlagSet, host *string, port *int) (string, int, error) {
	declaration := update.ReadDeclaration(root)
	written := false
	flags.Visit(func(set *flag.Flag) {
		switch set.Name {
		case "host":
			if trimmed := strings.TrimSpace(*host); trimmed != "" {
				declaration.Host, written = trimmed, true
			}
		case "port":
			if *port > 0 {
				declaration.Port, written = *port, true
			}
		}
	})
	if written {
		if err := update.WriteDeclaration(root, declaration); err != nil {
			return "", 0, fmt.Errorf("recording the address: %w", err)
		}
	}
	address, addressPort := declaration.Address()
	return address, addressPort, nil
}

// declareMachine records what a person asked for, before the work it describes (ADR 0030, amended). A
// failure here is loud: a command that does the work without leaving the intent is a machine the
// service will not bring back.
func declareMachine(root string, intent update.Intent) error {
	return update.WriteMachineIntent(root, intent)
}

// declareFromFlags is declareMachine for a command whose own flag set does not exist yet: the
// declaration comes before the command does its work, so it reads --root out of the arguments.
func declareFromFlags(argv []string, intent update.Intent) error {
	root, err := resolveRoot(rootFromFlags(argv), "")
	if err != nil {
		return err
	}
	return declareMachine(root, intent)
}

// rootFromFlags reads --root out of a command's arguments without parsing the rest: every command
// below parses its own flags, and the declaration only needs the mount.
func rootFromFlags(argv []string) string {
	for index, arg := range argv {
		if arg == "--root" && index+1 < len(argv) {
			return argv[index+1]
		}
		if value, found := strings.CutPrefix(arg, "--root="); found {
			return value
		}
	}
	return ""
}

// restartMachine is what `machine restart` does: declare the intent a restart means, then take the
// machine down and up. The two halves are arguments so the intent and its order are testable without
// a hypervisor — the down half is what writes `gone`, and a restart that declared afterwards would
// leave the service believing a person had taken the machine down.
func restartMachine(argv []string, down, up func([]string)) error {
	if err := declareFromFlags(argv, update.IntentRunning); err != nil {
		return err
	}
	down(argv)
	up(argv)
	return nil
}

// applianceImageHelp is the --image flag's help in all four commands. An install has one directory
// the machine boots, and which one it is depends on the layout the install was made in.
const applianceImageHelp = "the appliance image, an unpacked rootfs (default: the disk this install boots, <home>/machines/<machine>/rootfs, or <home>/appliance/rootfs for an install that has one)"

// The two directories the appliance can live in. The release's tarball is kept under the
// machinery, and each machine's disk is unpacked from it (ADR 0026, amended): one directory was
// both the artifact and the live disk, so a previous machine's containers were in the next
// machine's image and a fetch replaced the disk of a machine that was using it.
func applianceDisk(home string) string {
	return filepath.Join(home, "machines", sandbox.MachineName(home), "rootfs")
}

// legacyAppliance is the directory every install made before the artifact was kept boots from: the
// image and the disk in one tree.
func legacyAppliance(home string) string {
	return filepath.Join(home, "appliance", "rootfs")
}

// applianceDiskTag is the release a disk was unpacked from, written beside it when it was made. It
// is the launcher's own note rather than a mark inside the image: the release of an artifact is the
// artifact's name, and a disk that does not say which one made it is not this launcher's disk.
func applianceDiskTag(disk string) string {
	payload, err := os.ReadFile(filepath.Join(filepath.Dir(disk), "tag"))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(payload))
}

func writeApplianceDiskTag(disk, tag string) error {
	if err := os.MkdirAll(filepath.Dir(disk), 0o755); err != nil {
		return err
	}
	return os.WriteFile(filepath.Join(filepath.Dir(disk), "tag"), []byte(tag+"\n"), 0o644)
}

// applianceLayout is what the machine boots, and when it has to be made first, the artifact it is
// made from.
type applianceLayout struct {
	Image   string // the directory the engine boots
	Tarball string // the artifact it is unpacked from, "" when the disk is already there
	Unpack  bool   // whether the disk has to be made first
	Legacy  bool   // the one directory an install had before this layout
}

// applianceLayoutFor decides which directory the machine boots, in the order ADR 0026's amendment
// settles: the disk for the release this launcher runs, then the directory an install had before
// this layout, then the release's tarball unpacked into a disk of its own.
//
// The old directory is booted exactly as it was, and is never deleted or written into: it is what
// was working before this change, and it is still what boots when a fetch fails. It stops being
// booted once this launcher's release differs from the mark inside it, which is decision 2 of the
// ADR, with the old tree left where a person can find it.
func applianceLayoutFor(home, tag string, refresh bool) applianceLayout {
	disk := applianceDisk(home)
	if !refresh && tag != "" && checkAppliance(disk) == nil && applianceDiskTag(disk) == tag {
		return applianceLayout{Image: disk}
	}
	if legacy := legacyAppliance(home); !refresh && checkAppliance(legacy) == nil && applianceCurrent(legacy, tag, false) {
		return applianceLayout{Image: legacy, Legacy: true}
	}
	return applianceLayout{Image: disk, Tarball: update.ApplianceTarball(home, tag), Unpack: true}
}

// makeApplianceDisk makes the machine's disk from the release's tarball, and says which directory to
// boot. The artifact is fetched only when it is not here: it was verified when it was written, so a
// machine can be made from it with no network at all.
func makeApplianceDisk(ctx context.Context, home, root, tag string, plan applianceLayout, refresh bool) (string, error) {
	// One disk at a time per host: the service's own tick and a person's install both make one, and two unpacks
	// into one target is how a machine ends up with half an image.
	unlock, note, err := update.AcquireLock(root, time.Now())
	if err != nil {
		return "", err
	}
	defer unlock()
	if note != "" {
		log.Printf("machine: %s", note)
	}
	tarball, err := fetchApplianceTarball(ctx, home, tag, refresh)
	if err != nil {
		// An install whose network is down is a machine that still boots (ADR 0026, decision 5).
		// What is here is booted, and the line says which release it is instead of pretending.
		if fallback := fallbackAppliance(home, plan.Image); fallback != "" {
			log.Printf("machine: cannot fetch %s (%v): booting the appliance that is here (%s, %s)", tag, err, fallback, applianceDescribe(fallback))
			return fallback, nil
		}
		return "", err
	}
	if err := update.UnpackApplianceFile(tarball, plan.Image); err != nil {
		return "", err
	}
	if err := writeApplianceDiskTag(plan.Image, tag); err != nil {
		return "", err
	}
	// The mark is what a person reads, not what an update decision reads: the release came from the
	// tarball's name, and this keeps the file saying the same thing (ADR 0026, amended).
	if err := stampAppliance(plan.Image, tag); err != nil {
		return "", err
	}
	log.Printf("machine: made the machine's disk at %s from %s", plan.Image, tarball)
	return plan.Image, nil
}

// fallbackAppliance is what a machine boots when the release's tarball cannot be fetched: the disk
// the layout named when it is already an appliance, then the image directory of an install from
// before this layout.
func fallbackAppliance(home, disk string) string {
	for _, candidate := range []string{disk, legacyAppliance(home)} {
		if checkAppliance(candidate) == nil {
			return candidate
		}
	}
	return ""
}

// removeMachineDisk takes the machine's disk away and keeps the artifact it was made from: the
// tarball is what a machine is made of, so the next up is a copy rather than a download. It removes
// only the disk this layout made — the image directory of an install from before it, and a tree a
// person named with --image, are not ours to delete.
func removeMachineDisk(home, image string) (bool, error) {
	disk := applianceDisk(home)
	if filepath.Clean(image) != filepath.Clean(disk) {
		return false, nil
	}
	if err := os.RemoveAll(filepath.Dir(disk)); err != nil {
		return false, fmt.Errorf("the machine's disk is %s: %w", disk, err)
	}
	return true, nil
}

// fetchApplianceTarball is the network, in one place: a test replaces it to ask what the launcher
// does when GitHub cannot be reached.
var fetchApplianceTarball = func(ctx context.Context, home, tag string, refresh bool) (string, error) {
	return update.New(home, filepath.Dir(home), "", "").EnsureApplianceTarball(ctx, tag, refresh)
}

// fetchAppliance is what a tree a person named gets when it is not an appliance yet: the release's
// artifact, unpacked into it. The same artifact every other install keeps, so there is one way a
// machine is made rather than two.
var fetchAppliance = func(ctx context.Context, home, tag, image string) error {
	tarball, err := fetchApplianceTarball(ctx, home, tag, false)
	if err != nil {
		return err
	}
	return update.UnpackApplianceFile(tarball, image)
}

// applianceMark is the file the build writes into the image, naming it. It is the only thing that
// can tell one appliance from another: the tree is files either way, and a version a person can
// read is also the version the launcher can compare.
const applianceMark = "etc/acornfall-appliance"

// applianceCurrent says whether the image is the release this build runs. A named image is the
// person's, and a source build has no release to be: both keep what they have. An image that does
// not say which release it is — every image built before this mark carried one — is not current.
func applianceCurrent(image, tag string, given bool) bool {
	if given || !isReleaseTag(tag) {
		return true
	}
	return applianceVersion(image) == tag
}

// isReleaseTag is whether a tag names a release: `dev` is a source build, and it has no release to
// compare an image against.
func isReleaseTag(tag string) bool {
	return len(tag) > 1 && tag[0] == 'v' && tag[1] >= '0' && tag[1] <= '9'
}

// applianceVersion is the release an image says it is, or "" when it does not say.
func applianceVersion(image string) string {
	payload, err := os.ReadFile(filepath.Join(image, applianceMark))
	if err != nil {
		return ""
	}
	// "acornfall appliance v0.10.0-beta.12, debian stable, lxc 6.0.4"
	fields := strings.Fields(string(payload))
	if len(fields) < 3 || fields[0] != "acornfall" || fields[1] != "appliance" {
		return ""
	}
	return strings.Trim(fields[2], ",")
}

// applianceDescribe is the image's own sentence for a log line, with its release when it says one.
func applianceDescribe(image string) string {
	if version := applianceVersion(image); version != "" {
		return version
	}
	return "of no stated release"
}

// stampAppliance records which release the image is. It keeps the rest of the mark the build wrote
// — the base and the runtime version are still true — and replaces only the release.
func stampAppliance(image, tag string) error {
	path := filepath.Join(image, applianceMark)
	mark := "acornfall appliance " + tag
	if payload, err := os.ReadFile(path); err == nil {
		if _, after, found := strings.Cut(string(payload), ","); found {
			mark += ", " + strings.TrimSpace(after)
		}
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, []byte(mark+"\n"), 0o644)
}

// checkAppliance refuses an image that is not one, by name: the machine's error for a missing
// rootfs is "failed to start", which says nothing about what to do.
func checkAppliance(image string) error {
	for _, path := range []string{"usr/local/bin/acornfall", "usr/local/lib/acornfall/worker/src/main.ts"} {
		if _, err := os.Stat(filepath.Join(image, path)); err != nil {
			return fmt.Errorf("%s is not an appliance image (no %s): build one with scripts/build-appliance.sh, or unpack the release's", image, path)
		}
	}
	return nil
}

// awaitConsole waits for the appliance's own state endpoint: a published port that answers is
// the machine being ready, and anything earlier is a window that looks like a broken install.
func awaitConsole(ctx context.Context, url string, within time.Duration) error {
	deadline := time.Now().Add(within)
	client := &http.Client{Timeout: 5 * time.Second}
	for {
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, url+"/api/state", nil)
		if err != nil {
			return err
		}
		response, requestErr := client.Do(request)
		err = requestErr
		last := "no answer"
		if err == nil {
			response.Body.Close()
			if response.StatusCode == http.StatusOK {
				return nil
			}
			last = response.Status
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("the console never answered on %s within %s (last answer: %s)", url, within, last)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
}

// machineReady asks the machine's own state whether it is ready: a console that answers is not a
// product that works, and the state's own answer — is a worker up — is what a release has to show
// before the host takes it too (ADR 0031). One request, no wait: the service asks once a tick.
func machineReady(ctx context.Context, url string) bool {
	client := &http.Client{Timeout: 5 * time.Second}
	request, err := http.NewRequestWithContext(ctx, http.MethodGet, url+"/api/state", nil)
	if err != nil {
		return false
	}
	response, err := client.Do(request)
	if err != nil {
		return false
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		return false
	}
	var state struct {
		Workspace struct {
			WorkerUp bool `json:"workerUp"`
		} `json:"workspace"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 4<<20)).Decode(&state); err != nil {
		return false
	}
	return state.Workspace.WorkerUp
}

// awaitReady waits for the machine to report a worker ready within a bound, which is what
// `machine update` does between its two steps. The service does not wait: it asks, and asks again on
// the next tick.
func awaitReady(ctx context.Context, url string, within time.Duration) error {
	deadline := time.Now().Add(within)
	for {
		if machineReady(ctx, url) {
			return nil
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("the machine's state never reported a worker ready on %s within %s", url, within)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
}

// machineDown takes the machine away and records that nobody wants it back: `gone` is what stops the
// service from starting a machine a person took down, which it did within a second of the next tick
// (ADR 0030, amended).
func machineDown(argv []string) {
	if err := declareFromFlags(argv, update.IntentGone); err != nil {
		log.Fatalf("acornfall machine: %v", err)
	}
	takeMachineDown(argv)
}

// takeMachineDown is the removal without the declaration — the same down, for `restart`, which has
// already said what it wants and must not leave `gone` behind between its two halves. Its disk is
// the image and the product is in the mount, so what is lost is the containers and nothing of
// anyone's work: the next up makes a fresh machine from the same image, booting in seconds.
func takeMachineDown(argv []string) {
	flags := flag.NewFlagSet("acornfall machine down", flag.ContinueOnError)
	home := flags.String("home", "", "the machinery folder (default: ~/.acornfall)")
	root := flags.String("root", "", "the folder the machine mounts (default: ~/acornfall)")
	image := flags.String("image", "", applianceImageHelp)
	if err := flags.Parse(argv); err != nil {
		os.Exit(2)
	}
	resolvedHome, err := resolveDataDir(*home)
	if err != nil {
		log.Fatalf("acornfall machine: %v", err)
	}
	resolvedRoot, err := resolveRoot(*root, "")
	if err != nil {
		log.Fatalf("acornfall machine: %v", err)
	}
	resolvedImage := *image
	if resolvedImage == "" {
		resolvedImage = applianceLayoutFor(resolvedHome, applianceTag(""), false).Image
	}
	driver, err := machineDriver(resolvedHome, resolvedImage, resolvedRoot, 2, "4G", 7777, "127.0.0.1", applianceInit(resolvedRoot))
	if err != nil {
		log.Fatalf("acornfall machine: %v", err)
	}
	if !driver.Engine().Installed() {
		log.Printf("machine: no engine is installed here, so there is no machine to stop")
		return
	}
	ctx, cancel := context.WithTimeout(context.Background(), 3*time.Minute)
	defer cancel()
	if err := driver.RemoveMachine(ctx); err != nil {
		log.Fatalf("acornfall machine: %v", err)
	}
	if removed, err := removeMachineDisk(resolvedHome, resolvedImage); err != nil {
		log.Fatalf("acornfall machine: %v", err)
	} else if removed {
		log.Printf("machine: %s is gone, and so is its disk at %s (the appliance tarball stays)", driver.MachineName(), resolvedImage)
	} else {
		log.Printf("machine: %s is gone (the mount, and the image at %s, are not)", driver.MachineName(), resolvedImage)
	}
}

// machineStop shuts the machine down and leaves it there: the record stays, the image stays, and
// `machine up` starts the same machine again. `down` is the stronger verb — it removes it. The
// declaration is what keeps the service from starting it again a second later.
func machineStop(argv []string) {
	if err := declareFromFlags(argv, update.IntentStopped); err != nil {
		log.Fatalf("acornfall machine: %v", err)
	}
	stopMachine(argv)
}

func stopMachine(argv []string) {
	flags := flag.NewFlagSet("acornfall machine stop", flag.ContinueOnError)
	home := flags.String("home", "", "the machinery folder (default: ~/.acornfall)")
	root := flags.String("root", "", "the folder the machine mounts (default: ~/acornfall)")
	image := flags.String("image", "", applianceImageHelp)
	if err := flags.Parse(argv); err != nil {
		os.Exit(2)
	}
	resolvedHome, err := resolveDataDir(*home)
	if err != nil {
		log.Fatalf("acornfall machine: %v", err)
	}
	resolvedRoot, err := resolveRoot(*root, "")
	if err != nil {
		log.Fatalf("acornfall machine: %v", err)
	}
	resolvedImage := *image
	if resolvedImage == "" {
		resolvedImage = applianceLayoutFor(resolvedHome, applianceTag(""), false).Image
	}
	driver, err := machineDriver(resolvedHome, resolvedImage, resolvedRoot, 2, "4G", 7777, "127.0.0.1", applianceInit(resolvedRoot))
	if err != nil {
		log.Fatalf("acornfall machine: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
	defer cancel()
	if err := driver.MachineStop(ctx); err != nil {
		log.Fatalf("acornfall machine: %v", err)
	}
	log.Printf("machine: %s is stopped", driver.MachineName())
}
