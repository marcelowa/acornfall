package main

// `acornfall machine serve`: the process that keeps the machine up and applies the release the
// product asks for (ADR 0030). It has two duties and no third one: supervise the machine — start
// it, restart it when it exits, with backoff and a cap — and reconcile the intent the product
// declares in the mount with what is running. It is meant to run under systemd or launchd
// (scripts/units/), which is what makes it start at boot.

import (
	"context"
	"flag"
	"fmt"
	"log"
	"os"
	"os/signal"
	"strings"
	"syscall"
	"time"

	"github.com/acornfall/acornfall/gateway/internal/layout"
	"github.com/acornfall/acornfall/gateway/internal/sandbox"
	"github.com/acornfall/acornfall/gateway/internal/update"
)

const (
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
	home   string
	root   string
	cpus   int
	memory string
	port   int
	host   string
	token  string
}

func (d driverMachine) driver(image string) (*sandbox.LXC, error) {
	return machineDriver(d.home, image, d.root, d.cpus, d.memory, d.port, d.host, applianceInit(d.root, d.token))
}

func (d driverMachine) Running(ctx context.Context) (bool, error) {
	engine := sandbox.NewMicrosandbox(d.home)
	if !engine.Installed() {
		// No engine is no machine, which is the same answer and not an error: asking must not install.
		return false, nil
	}
	instances, err := engine.List(ctx)
	if err != nil {
		return false, err
	}
	name := sandbox.MachineName(d.home)
	for _, instance := range instances {
		if instance.Name == name {
			return instance.Running(), nil
		}
	}
	return false, nil
}

func (d driverMachine) Remove(ctx context.Context) error {
	driver, err := d.driver(applianceDisk(d.home))
	if err != nil {
		return err
	}
	return driver.RemoveMachine(ctx)
}

func (d driverMachine) Boot(ctx context.Context, image string) error {
	driver, err := d.driver(image)
	if err != nil {
		return err
	}
	return driver.EnsureMachine(ctx)
}

// supervisor is the service's head. Its decisions live here and its I/O lives behind the seams, so a
// test drives a crash loop, the cap and a failed apply without a hypervisor and without the clock.
type supervisor struct {
	home    string
	root    string
	service string
	machine machineControl
	// up makes sure there is something to boot and says where it is: the layout decision, without
	// taking away a machine that is running.
	up    func(ctx context.Context) (string, error)
	apply func(ctx context.Context, tag string) error
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
}

// tick is one pass of the service: reconcile the intent, keep the machine running, and answer what
// goes into is.json.
func (s *supervisor) tick(ctx context.Context) update.HostState {
	now := s.now()
	// The intent first, so the machine this state describes is the one the intent asked for.
	s.reconcile(ctx, now)
	if !now.Before(s.upHeld) {
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
		if !running {
			running = s.start(ctx, now)
		}
	}
	return update.HostState{
		Running:   running,
		Version:   applianceRunningVersion(s.home),
		Service:   s.service,
		LastError: s.lastErr,
		At:        update.StampedAt(now),
	}
}

// reconcile acts on the product's declared intent: one release it is not running, applied once. A
// refusal or a failure is a sentence in is.json, and the machine that is running is left exactly as
// it is — an update that failed must never take an install down with it (ADR 0030, decision 4).
func (s *supervisor) reconcile(ctx context.Context, now time.Time) {
	want, err := update.ReadWant(s.root)
	if err != nil {
		// A want.json the service refuses: the sentence names what is wrong with it, and nothing is
		// fetched on the strength of a value that did not parse.
		s.lastErr = err.Error()
		return
	}
	if want.Version == "" || want.Version == applianceRunningVersion(s.home) {
		return
	}
	if want.Version == s.failedTag && now.Sub(s.failedAt) < applyRetry {
		return
	}
	if err := s.apply(ctx, want.Version); err != nil {
		s.failedTag, s.failedAt = want.Version, now
		s.lastErr = fmt.Sprintf("applying %s: %v", want.Version, err)
		log.Printf("machine serve: %s (the machine that is running was left as it was)", s.lastErr)
		return
	}
	s.failedTag, s.failedAt = "", time.Time{}
	s.lastErr = ""
	log.Printf("machine serve: applied %s; the machine runs it now", want.Version)
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
func applianceRunningVersion(home string) string {
	if tag := applianceDiskTag(applianceDisk(home)); tag != "" {
		return tag
	}
	if legacy := legacyAppliance(home); checkAppliance(legacy) == nil {
		return applianceVersion(legacy)
	}
	return ""
}

// applianceUp makes sure there is something to boot and says which directory it is. An install that
// has a disk, or the image from before the layout, is left alone; one with neither is made from the
// release this build runs, which is the same first boot `machine up` does.
func applianceUp(ctx context.Context, home, tag string) (string, error) {
	plan := applianceLayoutFor(home, tag, false)
	if plan.Legacy || !plan.Unpack {
		return plan.Image, nil
	}
	if tag == "" {
		return "", fmt.Errorf("this build does not know its own version, so it cannot say which release to boot: pass --tag")
	}
	return makeApplianceDisk(ctx, home, tag, plan, false)
}

// applyRelease is one update, in the order that keeps the running machine until the new one is
// ready (ADR 0030, decision 4): the release's artifact is fetched and verified with nothing touched,
// a new disk is unpacked beside the live one, and only then is the machine taken away and the disk
// swapped in. Any failure before the swap leaves the machine running on the disk it has.
func applyRelease(ctx context.Context, home string, machine machineControl, tag string) error {
	if !update.IsReleaseVersion(tag) {
		return fmt.Errorf("%q is not a release tag", tag)
	}
	// The release has to exist before anything is fetched: EnsureApplianceTarball asks the release
	// list first, so a tag that names nothing is a sentence and not a download.
	tarball, err := fetchApplianceTarball(ctx, home, tag, false)
	if err != nil {
		return err
	}
	disk := applianceDisk(home)
	next := disk + ".next"
	if err := update.UnpackApplianceFile(tarball, next); err != nil {
		return err
	}
	if err := machine.Remove(ctx); err != nil {
		return err
	}
	if err := os.RemoveAll(disk); err != nil {
		return err
	}
	if err := os.Rename(next, disk); err != nil {
		return err
	}
	if err := writeApplianceDiskTag(disk, tag); err != nil {
		return err
	}
	// The mark is the file a person reads (ADR 0026, amended): stamped from the artifact's name, the
	// release that was verified, not from what the image claims.
	if err := stampAppliance(disk, tag); err != nil {
		return err
	}
	// Booting last: a machine that is gone and a disk that is in place is a machine the next tick
	// starts, so a boot that fails is a retry and not a lost install.
	return machine.Boot(ctx, disk)
}

// machineServe runs the service until it is asked to stop. The machine keeps running when it does:
// stopping the supervisor is not taking the machine down.
func machineServe(argv []string) {
	flags := flag.NewFlagSet("acornfall machine serve", flag.ContinueOnError)
	root := flags.String("root", "", "the folder the machine mounts: the product (default: ~/acornfall)")
	home := flags.String("home", "", "the machinery folder (default: ~/.acornfall)")
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

	resolvedRoot, err := resolveRoot(*root, "")
	if err != nil {
		log.Fatalf("acornfall machine serve: %v", err)
	}
	resolvedHome, err := resolveDataDir(*home)
	if err != nil {
		log.Fatalf("acornfall machine serve: %v", err)
	}
	where := layout.New(resolvedRoot, resolvedHome)
	if err := where.Ensure(); err != nil {
		log.Fatalf("acornfall machine serve: %v", err)
	}
	if err := layout.Migrate(where, log.Printf); err != nil {
		log.Printf("machine serve: moving the old layout: %v", err)
	}
	token := ""
	if contents, err := os.ReadFile(where.Token()); err == nil {
		token = strings.TrimSpace(string(contents))
	}
	if err := sandbox.NewMicrosandbox(resolvedHome).Install(ctx, log.Printf); err != nil {
		log.Fatalf("acornfall machine serve: %v", err)
	}
	machine := driverMachine{
		home:   resolvedHome,
		root:   resolvedRoot,
		cpus:   *cpus,
		memory: *memory,
		port:   *port,
		host:   *host,
		token:  token,
	}
	service := &supervisor{
		home:    resolvedHome,
		root:    resolvedRoot,
		service: update.BuildVersion,
		machine: machine,
		up: func(ctx context.Context) (string, error) {
			// What is here decides; this build's release is only the answer when nothing is.
			here := applianceRunningVersion(resolvedHome)
			if here == "" {
				here = applianceTag(*tag)
			}
			return applianceUp(ctx, resolvedHome, here)
		},
		apply: func(ctx context.Context, wanted string) error {
			return applyRelease(ctx, resolvedHome, machine, wanted)
		},
		now:   time.Now,
		image: applianceLayoutFor(resolvedHome, applianceTag(*tag), false).Image,
	}
	log.Printf("machine serve: supervising %s as %s; a release the product asks for in want.json is applied, and a machine that exits comes back", sandbox.MachineName(resolvedHome), update.BuildVersion)
	for {
		state := service.tick(ctx)
		if err := update.WriteIs(resolvedRoot, state); err != nil {
			log.Printf("machine serve: cannot write %s, which the console reads: %v", update.IsPath(resolvedRoot), err)
		}
		select {
		case <-ctx.Done():
			log.Printf("machine serve: asked to stop; the machine keeps running")
			return
		case <-time.After(serveInterval):
		}
	}
}
