package main

// `acornfall machine serve`: the process that keeps the machine up and applies the release the
// product asks for (ADR 0030). It has two duties and no third one: supervise the machine — start
// it, restart it when it exits, with backoff and a cap — and reconcile the intent the product
// declares in the mount with what is running. It is meant to run under systemd or launchd
// (scripts/units/), which is what makes it start at boot.
//
// It enforces two declarations and makes neither of them: the product's release in want.json, and a
// person's "should this machine exist" in state/machine.json. Nothing is started unless a person
// said `running`, so `machine down` is final instead of being undone by the next second's tick.

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"path/filepath"
	"runtime"
	"syscall"
	"time"

	"github.com/acornfall/acornfall/gateway/internal/layout"
	"github.com/acornfall/acornfall/gateway/internal/sandbox"
	"github.com/acornfall/acornfall/gateway/internal/update"
)

const (
	// The names a log line carries. A person reading "machine serve:" while `machine update` is failing
	// is reading about a process they are not running, and the shared apply is called by both.
	serveName   = "machine serve"
	commandName = "machine update"

	// serveInterval is how often the service looks. A person who presses update should see the
	// machine change within a second or two, and two small files a second are nothing.
	serveInterval = time.Second
	// applyRetry spaces out attempts that fail: a release that cannot be fetched would otherwise be
	// a request per second, and a rate limit is the answer that makes it permanent. It also spaces
	// out the first fetch of an install whose network is down.
	applyRetry = 30 * time.Second
	// restartLimit is how many starts a machine gets before the service stops restarting it, and
	// restartStable is how long it must stay up for the count to be forgotten. A deterministic
	// crash must not loop forever in silence.
	restartLimit  = 5
	restartBase   = time.Second
	restartCap    = time.Minute
	restartStable = 2 * time.Minute
)

// machineControl is the machine as the service needs it: is it there, take it away, boot it from a
// directory. An interface because a test drives the decisions without a hypervisor (G2: it is
// declared where it is consumed, and it has a test double).
type machineControl interface {
	Running(ctx context.Context) (bool, error)
	Remove(ctx context.Context) error
	Boot(ctx context.Context, image string) error
}

// driverMachine is the real one: the engine the launcher already uses, asked the same questions.
type driverMachine struct {
	machinery string
	share     string
	cpus      int
	memory    string
	port      int
	host      string
}

func (d driverMachine) driver(image string) (*sandbox.LXC, error) {
	return machineDriver(d.machinery, image, d.share, d.cpus, d.memory, d.port, d.host, applianceInit(d.share))
}

func (d driverMachine) Running(ctx context.Context) (bool, error) {
	engine := sandbox.NewMicrosandbox(d.machinery)
	if !engine.Installed() {
		// No engine is no machine, which is the same answer and not an error: asking must not install.
		return false, nil
	}
	instances, err := engine.List(ctx)
	if err != nil {
		return false, err
	}
	name := sandbox.MachineName(d.machinery)
	for _, instance := range instances {
		if instance.Name == name {
			return instance.Running(), nil
		}
	}
	return false, nil
}

func (d driverMachine) Remove(ctx context.Context) error {
	driver, err := d.driver(applianceDisk(d.machinery))
	if err != nil {
		return err
	}
	return driver.RemoveMachine(ctx)
}

func (d driverMachine) Boot(ctx context.Context, image string) error {
	// The engine child runs as the share's owner. The image and the machinery were written by
	// the root install; give them to that owner before the engine tries to boot the machine.
	if err := ensureShareOwner(d.share, d.machinery); err != nil {
		return err
	}
	driver, err := d.driver(image)
	if err != nil {
		return err
	}
	return driver.EnsureMachine(ctx)
}

// supervisor is the service's head. Its decisions live here and its I/O lives behind the seams, so a
// test drives a crash loop, the cap and a failed apply without a hypervisor and without the clock.
type supervisor struct {
	machinery string
	share     string
	service   string
	machine   machineControl
	// up makes sure there is something to boot and says where it is: the layout decision, without
	// taking away a machine that is running.
	up    func(ctx context.Context) (string, error)
	apply func(ctx context.Context, tag string) (string, error)
	now   func() time.Time

	// image is the directory the machine boots, as last worked out: a failed `up` keeps booting what
	// was booted before rather than booting nothing.
	image string
	// restarts counts the starts since the machine last stayed up, startedAt is when it last booted,
	// and nextStart is the earliest moment a restart may be tried.
	restarts  int
	startedAt time.Time
	nextStart time.Time
	gaveUp    bool
	// failedTag and failedAt are the release whose apply failed and when, so a release that cannot
	// be fetched is not fetched again every second while the screen says what went wrong.
	failedTag string
	failedAt  time.Time
	// upHeld is when a failed `up` may be tried again.
	upHeld time.Time
	// lastErr is the sentence is.json carries: the last thing that went wrong, or "".
	lastErr string

	// Step 2 of an update (ADR 0031): the host takes the release the machine runs and reports ready.
	// `ownsSelf` is whether this process is the binary the install owns — a service started from
	// anywhere else serves and does not replace itself — and the two host-specific parts are seams,
	// so the decision is testable without a hypervisor.
	ownsSelf     bool
	downloadSelf func(ctx context.Context, tag string) ([]byte, error)
	ready        func(ctx context.Context) bool
	exit         func(code int)

	// selfHeldTag and selfHeldAt hold a release whose step 2 failed: the same delay as a failed
	// apply, because a release that cannot be fetched is not one to ask GitHub for every second.
	selfHeldTag string
	selfHeldAt  time.Time
	// selfMissing is a release with no binary for this host: logged once and never retried.
	selfMissing string
	// selfRefused is the one line a service that was not started through the symlink says.
	selfRefused bool
}

// tick is one pass of the service: reconcile the intent, keep the machine running, and answer what
// goes into is.json.
func (s *supervisor) tick(ctx context.Context) update.HostState {
	now := s.now()
	// The product's intent first, so the machine this state describes is the one it asked for.
	s.reconcile(ctx, now)
	// A person decides whether the machine exists at all, and the service only enforces it: no
	// declaration is a host where a person drives, and a machine taken down stays down (ADR 0030,
	// amended). This is the one place the question is asked — the start below and the boot after an
	// apply both come through here or through the same rule.
	wanted := update.WantsRunning(s.share)
	if wanted && !now.Before(s.upHeld) {
		if image, err := s.up(ctx); err != nil {
			s.lastErr = err.Error()
			s.upHeld = now.Add(applyRetry)
			log.Printf("machine serve: %v", err)
		} else {
			s.image = image
		}
	}
	running := false
	if reported, err := s.machine.Running(ctx); err != nil {
		s.lastErr = "asking the engine about the machine: " + err.Error()
	} else {
		running = reported
		if running && !s.startedAt.IsZero() && now.Sub(s.startedAt) >= restartStable {
			// It stayed up: the next exit is a new problem, not the sixth of the same one.
			s.restarts = 0
			s.startedAt = time.Time{}
		}
		// The backoff and the cap are for a machine that should be up and keeps dying; a machine a
		// person stopped is not a crash loop and is not asked to come back.
		if !running && wanted {
			// A disk that is being replaced must not be booted: the process holding the lock is writing the tree
			// this would start a machine on. It is not a failure, and the next tick asks again.
			if update.LockHeld(s.share, now) {
				log.Printf("machine serve: not starting the machine: an update holds the disk")
			} else {
				running = s.start(ctx, now)
			}
		}
	}
	version := applianceRunningVersion(s.machinery)
	s.reconcileSelf(ctx, now, running, version)
	return update.HostState{
		Running:   running,
		Version:   version,
		Service:   s.service,
		LastError: s.lastErr,
		At:        update.StampedAt(now),
	}
}

// reconcile acts on the product's declared intent: one release it is not running, applied once. A
// refusal or a failure is a sentence in is.json, and the machine that is running is left exactly as
// it is — an update that failed must never take an install down with it (ADR 0030, decision 4).
func (s *supervisor) reconcile(ctx context.Context, now time.Time) {
	want, err := update.ReadWant(s.share)
	if err != nil {
		// A want.json the service refuses: the sentence names what is wrong with it, and nothing is
		// fetched on the strength of a value that did not parse.
		s.lastErr = err.Error()
		return
	}
	if want.Version == "" || want.Version == applianceRunningVersion(s.machinery) {
		return
	}
	if want.Version == s.failedTag && now.Sub(s.failedAt) < applyRetry {
		return
	}
	// One update at a time per host: `machine update` writes the same disk, so a second apply while it
	// runs is a state this design does not have (ADR 0031). A live lock is not a failure — the next tick
	// asks again — and the lock is released on every way out of here.
	unlock, note, lockErr := update.AcquireLock(s.share, now)
	if lockErr != nil {
		log.Printf("machine serve: the machine's update waits: %v", lockErr)
		return
	}
	if note != "" {
		log.Printf("machine serve: %s", note)
	}
	_, err = s.apply(ctx, want.Version)
	unlock()
	if err != nil {
		s.failedTag, s.failedAt = want.Version, now
		s.lastErr = fmt.Sprintf("applying %s: %v", want.Version, err)
		log.Printf("machine serve: %s (the machine that is running was left as it was)", s.lastErr)
		return
	}
	s.failedTag, s.failedAt = "", time.Time{}
	s.lastErr = ""
	// A request kept for a machine nobody declared running is not an apply, and the log must not say
	// it was: the next tick after `up` picks it up with no other code (ADR 0030, amended).
	if applianceRunningVersion(s.machinery) != want.Version {
		return
	}
	log.Printf("machine serve: applied %s; the machine runs it now", want.Version)
}

// reconcileSelf is step 2 (ADR 0031): the host takes a release the machine runs and reports ready,
// which is a different version from the one this process runs. There is no timer and no record of
// evidence — the condition is asked on every tick, and the first tick it holds is the tick the host
// swaps. A machine that is running but not ready does nothing, and is asked again next tick; a
// machine that stops does nothing at all.
func (s *supervisor) reconcileSelf(ctx context.Context, now time.Time, running bool, version string) {
	if s.service == "" || version == "" || s.service == version {
		// Nothing to take: this process already runs the release the machine does.
		return
	}
	if !update.Newer(version, s.service) {
		// The machine is older than this service. That is not an update to take: the host was
		// installed ahead of the machine — a machine install that failed after swapping the host,
		// for one — and taking the machine's release would move the host backwards. The machine
		// is repaired by an install or an update; the host stays where it is.
		return
	}
	if !s.ownsSelf {
		if !s.selfRefused {
			s.selfRefused = true
			s.lastErr = "this service was not started through " + update.OwnedBinary(s.machinery) + ", so it will not replace itself"
			log.Printf("machine serve: %s", s.lastErr)
		}
		return
	}
	// Another process may have put this release in place — `machine update` does — and then the only
	// thing left is to restart into it.
	if update.PointsAt(s.machinery, version) {
		log.Printf("machine serve: %s is in place for the host; this process exits so the supervisor starts it", version)
		s.exit(0)
		return
	}
	if !running {
		return
	}
	// Readiness is the gate, not time: the machine's own state has to report a worker ready, and a
	// release that boots into a console with no worker behind it has not shown it works.
	if s.ready == nil || !s.ready(ctx) {
		return
	}
	if s.selfHeldTag == version && now.Sub(s.selfHeldAt) < applyRetry {
		return
	}
	if s.selfMissing == version {
		return
	}
	if s.downloadSelf == nil {
		return
	}
	if err := s.takeSelf(ctx, now, version); err != nil {
		s.holdSelf(version, now, err)
		return
	}
	log.Printf("machine serve: the machine runs %s and reports ready; the host is now %s and this process exits so the supervisor starts it", version, version)
	s.exit(0)
}

// takeSelf swaps the host's binary under the one update lock, and returns only once the lock is gone:
// the caller exits next, and an exit does not run a deferred unlock (ADR 0031, the leak that made a
// dead pid's lock the next run's problem).
func (s *supervisor) takeSelf(ctx context.Context, now time.Time, version string) error {
	unlock, note, err := update.AcquireLock(s.share, now)
	if err != nil {
		return err
	}
	defer unlock()
	if note != "" {
		log.Printf("machine serve: %s", note)
	}
	binary, err := s.downloadSelf(ctx, version)
	if err != nil {
		return err
	}
	return update.SwapSelf(s.machinery, s.share, version, binary)
}

// holdSelf keeps a failed step 2 for the same delay a failed apply gets, and says why. A release with
// no binary for this host is not a fault to retry at all: it is logged once and held.
func (s *supervisor) holdSelf(tag string, now time.Time, err error) {
	sentence := "taking " + tag + " for the host: " + err.Error()
	if errors.Is(err, update.ErrNoSelfAsset) {
		s.selfMissing = tag
	}
	s.selfHeldTag, s.selfHeldAt = tag, now
	if s.lastErr != sentence {
		s.lastErr = sentence
		log.Printf("machine serve: %s", sentence)
	}
}

// start boots the machine when this is a moment a restart is allowed. The count is what turns a
// crash loop into one line in a log: after restartLimit starts the service stops and says so.
func (s *supervisor) start(ctx context.Context, now time.Time) bool {
	if s.gaveUp || now.Before(s.nextStart) {
		return false
	}
	if s.restarts >= restartLimit {
		s.gaveUp = true
		s.lastErr = fmt.Sprintf("the machine has been started %d times and has not stayed up for %s; the service has stopped restarting it", s.restarts, restartStable)
		log.Printf("machine serve: %s", s.lastErr)
		return false
	}
	s.restarts++
	if err := s.machine.Boot(ctx, s.image); err != nil {
		s.nextStart = now.Add(backoff(s.restarts))
		s.lastErr = fmt.Sprintf("booting the machine: %v", err)
		log.Printf("machine serve: cannot boot the machine (start %d of %d): %v", s.restarts, restartLimit, err)
		return false
	}
	s.startedAt = now
	// The delay is set even though the boot worked: a machine that dies before the next tick is the
	// crash this is for, and a boot that worked is not evidence the next one will.
	s.nextStart = now.Add(backoff(s.restarts))
	log.Printf("machine serve: the machine is up (start %d of %d before the service gives up)", s.restarts, restartLimit)
	return true
}

// backoff is how long a restart waits: one second, two, four, up to a minute.
func backoff(restarts int) time.Duration {
	if restarts < 1 {
		restarts = 1
	}
	if restarts > 20 {
		return restartCap
	}
	delay := restartBase << (restarts - 1)
	if delay > restartCap {
		return restartCap
	}
	return delay
}

// applianceRunningVersion is the release the machine on this disk is: the disk's own record, or the
// mark inside the image an install had before the artifact was kept (ADR 0026, amended). It is what
// is.json's version means.
func applianceRunningVersion(machinery string) string {
	if tag := applianceDiskTag(applianceDisk(machinery)); tag != "" {
		return tag
	}
	if legacy := legacyAppliance(machinery); checkAppliance(legacy) == nil {
		return applianceVersion(legacy)
	}
	return ""
}

// applianceUp makes sure there is something to boot and says which directory it is. An install that
// has a disk, or the image from before the layout, is left alone; one with neither is made from the
// release this build runs, which is the same first boot `machine up` does.
func applianceUp(ctx context.Context, machinery, share, tag string, before func() error) (string, error) {
	plan := applianceLayoutFor(machinery, tag, false)
	if plan.Legacy || !plan.Unpack {
		return plan.Image, nil
	}
	if tag == "" {
		return "", fmt.Errorf("this build does not know its own version, so it cannot say which release to boot: pass --tag")
	}
	return makeApplianceDisk(ctx, machinery, share, tag, plan, false, before)
}

// applyRelease is one update, in the order that keeps the running machine until the new one is
// ready (ADR 0030, decision 4): the release's artifact is fetched and verified with nothing touched,
// a new disk is unpacked beside the live one, and only then is the machine taken away and the disk
// swapped in. Any failure before the swap leaves the machine running on the disk it has.
// applyRelease is one update of the machine. `allowed` is the declaration it runs under, passed by the
// caller: the service applies only what a person declared in machine.json, and a command a person typed
// passes nothing, because typing it was the declaration (ADR 0031) — a command cannot be refused for
// not being declared by a person. `name` is the caller's, so the line a refused apply leaves is not a
// sentence about a service printed by a command.
func applyRelease(ctx context.Context, machinery string, machine machineControl, tag string, allowed func() bool, name string) (string, error) {
	if !update.IsReleaseVersion(tag) {
		return "", fmt.Errorf("%q is not a release tag", tag)
	}
	// A machine nobody declared running is not given a body: `gone` says the machine is not here, and a
	// disk made a second later is the same lie smaller — a person asked for it to be gone and would
	// find 575 MB where they expected nothing (ADR 0030, amended). Nothing is lost by waiting: the
	// request lives in the mount, which `down` does not touch, and the next tick after a person says
	// `up` applies it.
	if allowed != nil && !allowed() {
		log.Printf("%s: keeping the request for %s; no person declared the machine running", name, tag)
		return "", nil
	}
	// The release has to exist before anything is fetched: EnsureApplianceTarball asks the release
	// list first, so a tag that names nothing is a sentence and not a download.
	tarball, err := fetchApplianceTarball(ctx, machinery, tag, false)
	if err != nil {
		return "", err
	}
	disk := applianceDisk(machinery)
	next := disk + ".next"
	if err := update.UnpackApplianceFile(tarball, next); err != nil {
		return "", err
	}
	// From here the half-made disk exists, and every way out that is not a boot takes it away: a
	// folder left beside the live one is a machine's worth of bytes nobody asked for, and the next
	// attempt would unpack over it.
	abandon := func(err error) (string, error) {
		_ = os.RemoveAll(next)
		return "", err
	}
	if err := machine.Remove(ctx); err != nil {
		return abandon(err)
	}
	if err := os.RemoveAll(disk); err != nil {
		return abandon(err)
	}
	if err := os.Rename(next, disk); err != nil {
		return abandon(err)
	}
	if err := writeApplianceDiskTag(disk, tag); err != nil {
		return "", err
	}
	// The mark is the file a person reads (ADR 0026, amended): stamped from the artifact's name, the
	// release that was verified, not from what the image claims.
	if err := stampAppliance(disk, tag); err != nil {
		return "", err
	}
	// Booting last: a machine that is gone and a disk that is in place is a machine the next tick
	// starts, so a boot that fails is a retry and not a lost install.
	if err := machine.Boot(ctx, disk); err != nil {
		return "", err
	}
	return disk, nil
}

// rollBackSelf is the first thing the service does (ADR 0031): a boot marker that names the version
// this binary runs means an earlier start of this version never reached ready, so the symlink goes
// back to the binary before it and this process exits 1. The supervisor starts the old one; a binary
// that cannot start at all therefore undoes itself instead of looping.
//
// The swap writes the marker before the new binary has ever run, so its first start must claim it
// rather than read it as a failure. Claiming is writing Started; the next start that finds it claimed
// is the one that knows the previous start died. Without this phase, the first start of every update
// rolled back and the host never moved.
func rollBackSelf(machinery, share, service string, exit func(int)) {
	attempt, found := update.ReadBootAttempt(share)
	if !found {
		return
	}
	if attempt.Tag != service {
		// Another version's marker: the start that wrote it got somewhere, so it is stale.
		update.RemoveBootAttempt(share)
		return
	}
	if !attempt.Started {
		// This is the first start after the swap. Claim the marker and go on; a later start that
		// finds it claimed is the one that rolls back.
		attempt.Started = true
		if err := update.WriteBootAttempt(share, attempt); err != nil {
			// The marker stays unclaimed, so the next start claims it again instead of rolling
			// back. That is safer than treating an unwritable marker as a failed binary.
			log.Printf("machine serve: cannot claim the boot marker for %s: %v", service, err)
		}
		return
	}
	previous, err := update.PreviousBinary(machinery, service)
	if err != nil || previous == "" {
		log.Printf("machine serve: %s did not reach ready last time, and there is no earlier binary to go back to", service)
		update.RemoveBootAttempt(share)
		exit(1)
		return
	}
	if err := update.PointAt(machinery, filepath.Base(previous)[len("acornfall-"):]); err != nil {
		log.Printf("machine serve: going back to %s failed: %v", previous, err)
		update.RemoveBootAttempt(share)
		exit(1)
		return
	}
	update.RemoveBootAttempt(share)
	log.Printf("machine serve: %s did not reach ready last time; the host is going back to %s", service, filepath.Base(previous))
	exit(1)
}

// refreshHostUnit writes the unit this platform's init reads, when it differs from the embedded
// template, and reloads the init. It is a repair, not an install: the unit path and the flags come
// from the declaration the service already resolved. A failure is a log line; the service keeps
// serving the machine it has.
func refreshHostUnit(ctx context.Context, machinery, share, host string, port int) {
	init := initFor(runtime.GOOS)
	if init == nil {
		return
	}
	cfg := unitConfig{
		UserHome:  userHomeDir(),
		Machinery: machinery,
		Share:     share,
		Host:      host,
		Port:      port,
	}
	path, content, err := init.Unit(cfg)
	if err != nil {
		log.Printf("machine serve: cannot render the %s unit: %v", init.Name(), err)
		return
	}
	wrote, err := writeIfDifferent(path, []byte(content), 0o644)
	if err != nil {
		log.Printf("machine serve: cannot repair the %s unit at %s: %v", init.Name(), path, err)
		return
	}
	if !wrote {
		return
	}
	if err := init.Reload(ctx); err != nil {
		log.Printf("machine serve: wrote the %s unit at %s but the %s did not reload: %v", init.Name(), path, init.Name(), err)
		return
	}
	log.Printf("machine serve: repaired the %s unit at %s; the next restart uses it", init.Name(), path)
}

// machineServe runs the service until it is asked to stop. The machine keeps running when it does:
// stopping the supervisor is not taking the machine down.
func machineServe(argv []string) {
	flags := flag.NewFlagSet("acornfall machine serve", flag.ContinueOnError)
	share := flags.String("share", "", "the folder the machine mounts: the product (default: /srv/acornfall as root, ~/acornfall otherwise)")
	machinery := flags.String("machinery", "", "the machinery folder (default: /var/lib/acornfall as root, ~/.acornfall otherwise)")
	tag := flags.String("tag", "", "the release to boot when there is nothing here yet (default: this build's version)")
	port := flags.Int("port", 7777, "the host port the console is published on")
	// Loopback for the same reason `machine up` is: the appliance runs with --insecure.
	host := flags.String("host", "127.0.0.1", "the host address the console is published on (0.0.0.0 exposes an unauthenticated console)")
	cpus := flags.Int("cpus", 2, "virtual cpus for the machine")
	memory := flags.String("memory", "4G", "memory for the machine")
	if err := flags.Parse(argv); err != nil {
		os.Exit(2)
	}
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	resolvedShare, err := resolveShare(*share, "")
	if err != nil {
		log.Fatalf("acornfall machine serve: %v", err)
	}
	resolvedHome, err := resolveDataDir(*machinery)
	if err != nil {
		log.Fatalf("acornfall machine serve: %v", err)
	}
	where := layout.New(resolvedShare, resolvedHome)
	if err := where.Ensure(); err != nil {
		log.Fatalf("acornfall machine serve: %v", err)
	}
	if err := layout.Migrate(where, log.Printf); err != nil {
		log.Printf("machine serve: moving the old layout: %v", err)
	}
	if err := ensureShareOwner(resolvedShare, resolvedHome); err != nil {
		log.Fatalf("acornfall machine serve: the share's owner: %v", err)
	}
	// Before anything else: a marker that names this binary's version is the last start never reaching
	// ready, and the answer is the binary before it (ADR 0031).
	rollBackSelf(resolvedHome, resolvedShare, update.BuildVersion, os.Exit)
	if err := sandbox.NewMicrosandbox(resolvedHome).Install(ctx, log.Printf); err != nil {
		log.Fatalf("acornfall machine serve: %v", err)
	}
	executable, err := os.Executable()
	if err != nil {
		log.Fatalf("acornfall machine serve: %v", err)
	}
	// The address is the declaration's, and a flag that was given wrote it first: one file says what the
	// machine is, so the unit and the command cannot disagree (ADR 0030, amended).
	*host, *port, err = declaredAddress(resolvedShare, flags, host, port)
	if err != nil {
		log.Fatalf("acornfall machine serve: %v", err)
	}
	// The unit is generated by install, but a service that is already running can repair the
	// copy it came from. That is how a unit change reaches a host that was updated rather than
	// reinstalled; the running unit takes the new setting on its next restart.
	refreshHostUnit(ctx, resolvedHome, resolvedShare, *host, *port)
	console := consoleURL(*host, *port)
	manager := update.New(resolvedHome, resolvedShare, "", "")
	machine := driverMachine{
		machinery: resolvedHome,
		share:     resolvedShare,
		cpus:      *cpus,
		memory:    *memory,
		port:      *port,
		host:      *host,
	}
	service := &supervisor{
		machinery: resolvedHome,
		share:     resolvedShare,
		service:   update.BuildVersion,
		machine:   machine,
		up: func(ctx context.Context) (string, error) {
			// What is here decides; this build's release is only the answer when nothing is.
			here := applianceRunningVersion(resolvedHome)
			if here == "" {
				here = applianceTag(*tag)
			}
			// The service never takes a machine away to make a disk: a person's command does that, and the
			// service only boots what is there.
			return applianceUp(ctx, resolvedHome, resolvedShare, here, nil)
		},
		apply: func(ctx context.Context, wanted string) (string, error) {
			return applyRelease(ctx, resolvedHome, machine, wanted, func() bool {
				return update.WantsRunning(resolvedShare)
			}, serveName)
		},
		now:   time.Now,
		image: applianceLayoutFor(resolvedHome, applianceTag(*tag), false).Image,
		// Step 2 (ADR 0031): the machine runs a release and reports ready, and the host takes it.
		ownsSelf: update.OwnsSelf(executable, resolvedHome),
		downloadSelf: func(ctx context.Context, tag string) ([]byte, error) {
			return manager.DownloadSelf(ctx, tag)
		},
		ready: func(ctx context.Context) bool { return machineReady(ctx, console) },
		exit:  os.Exit,
	}
	if !service.ownsSelf {
		log.Printf("machine serve: this is not %s, so the host will not replace it; the service still supervises and applies the product's releases", update.OwnedBinary(resolvedHome))
	}
	log.Printf("machine serve: supervising %s as %s; a release the product asks for in want.json is applied, and a machine that exits comes back", sandbox.MachineName(resolvedHome), update.BuildVersion)
	ready := false
	for {
		state := service.tick(ctx)
		if err := update.WriteIs(resolvedShare, state); err != nil {
			log.Printf("machine serve: cannot write %s, which the console reads: %v", update.IsPath(resolvedShare), err)
		} else if !ready {
			// One full tick done — the machine asked about and the state written — is the service
			// being ready, and it is what earns the marker's removal (ADR 0031).
			ready = true
			update.RemoveBootAttempt(resolvedShare)
		}
		select {
		case <-ctx.Done():
			log.Printf("machine serve: asked to stop; the machine keeps running")
			return
		case <-time.After(serveInterval):
		}
	}
}
