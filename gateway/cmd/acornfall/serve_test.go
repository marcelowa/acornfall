package main

import (
	"archive/tar"
	"compress/gzip"
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/acornfall/acornfall/gateway/internal/update"
)

// fakeMachine is the engine behind `machine up`, answering the three questions the service asks. A
// test drives a crash by setting running back to false, and the boot itself by bootErr.
type fakeMachine struct {
	running    bool
	boots      int
	removes    int
	bootErr    error
	runningErr error
	lastImage  string
}

func (f *fakeMachine) Running(context.Context) (bool, error) { return f.running, f.runningErr }

func (f *fakeMachine) Remove(context.Context) error { f.removes++; return nil }

func (f *fakeMachine) Boot(_ context.Context, image string) error {
	f.boots++
	f.lastImage = image
	if f.bootErr != nil {
		return f.bootErr
	}
	f.running = true
	return nil
}

// fakeClock is the service's clock: a test decides when a second, a backoff and a stable machine
// have passed, so nothing here waits on the wall.
type fakeClock struct{ at time.Time }

func (c *fakeClock) now() time.Time          { return c.at }
func (c *fakeClock) advance(d time.Duration) { c.at = c.at.Add(d) }

func newSupervisor(t *testing.T, machine machineControl, apply func(context.Context, string) error) (*supervisor, *fakeClock, string, string) {
	t.Helper()
	home := t.TempDir()
	root := t.TempDir()
	clock := &fakeClock{at: time.Date(2026, 10, 22, 9, 0, 0, 0, time.UTC)}
	if apply == nil {
		apply = func(context.Context, string) error { return nil }
	}
	// The person's declaration, unless a test says otherwise: a machine the service is meant to keep
	// up is one somebody asked for (ADR 0030, amended).
	if err := update.WriteMachineIntent(root, update.IntentRunning); err != nil {
		t.Fatal(err)
	}
	service := &supervisor{
		home:    home,
		root:    root,
		service: "v0.10.0-beta.14",
		machine: machine,
		up:      func(context.Context) (string, error) { return applianceDisk(home), nil },
		apply:   apply,
		now:     clock.now,
		image:   applianceDisk(home),
	}
	return service, clock, home, root
}

// makeRunningDisk lays out the machine this install boots, as the launcher would have left it: a
// disk and the record of the release it was unpacked from.
func makeRunningDisk(t *testing.T, home, tag string) {
	t.Helper()
	disk := applianceDisk(home)
	writeApplianceFiles(t, disk, "")
	if err := writeApplianceDiskTag(disk, tag); err != nil {
		t.Fatal(err)
	}
}

// The first duty: a machine that is not running is started, and the state says so in the same tick
// — a console that says "stopped" for a second after it came back is a screen that lies.
func TestTheServiceStartsTheMachineThatIsNotRunning(t *testing.T) {
	machine := &fakeMachine{}
	service, _, home, _ := newSupervisor(t, machine, nil)
	state := service.tick(context.Background())
	if machine.boots != 1 {
		t.Fatalf("boots = %d, want 1", machine.boots)
	}
	if !state.Running {
		t.Error("the state says stopped after it was started")
	}
	if machine.lastImage != applianceDisk(home) {
		t.Errorf("booted %q, want the install's disk", machine.lastImage)
	}
	// A machine that is running is not started again.
	service.tick(context.Background())
	if machine.boots != 1 {
		t.Errorf("a running machine was started again: %d boots", machine.boots)
	}
}

// The second: an exit comes back, with a growing delay, and the count is what keeps a machine that
// dies at once from looping forever in the log.
func TestACrashComesBackWithBackoffAndThenTheServiceStops(t *testing.T) {
	machine := &fakeMachine{}
	service, clock, _, _ := newSupervisor(t, machine, nil)
	service.tick(context.Background())
	if machine.boots != 1 {
		t.Fatalf("boots = %d, want 1", machine.boots)
	}
	for start := 2; start <= restartLimit; start++ {
		machine.running = false
		before := machine.boots
		service.tick(context.Background())
		if machine.boots != before {
			t.Fatalf("start %d came back before its backoff", start)
		}
		clock.advance(backoff(start - 1))
		service.tick(context.Background())
		if machine.boots != before+1 {
			t.Fatalf("start %d did not come back after its backoff", start)
		}
	}
	// One more exit, past the cap: no boot, and the service says plainly that it stopped.
	machine.running = false
	clock.advance(restartCap)
	state := service.tick(context.Background())
	if machine.boots != restartLimit {
		t.Fatalf("the cap let another start through: %d boots", machine.boots)
	}
	if !strings.Contains(state.LastError, "stopped restarting") {
		t.Errorf("the cap is not said out loud: %q", state.LastError)
	}
	if state.Running {
		t.Error("the state says running after the service gave up")
	}
}

// A machine that stays up has its count forgotten: the next exit is a new problem, not the sixth of
// the same one.
func TestAMachineThatStaysUpStartsItsCountAgain(t *testing.T) {
	machine := &fakeMachine{}
	service, clock, _, _ := newSupervisor(t, machine, nil)
	service.tick(context.Background())
	for start := 1; start <= 3; start++ {
		machine.running = false
		clock.advance(restartCap)
		service.tick(context.Background())
	}
	if service.restarts != 4 || service.gaveUp {
		t.Fatalf("restarts = %d, gaveUp = %v", service.restarts, service.gaveUp)
	}
	clock.advance(restartStable)
	service.tick(context.Background())
	if service.restarts != 0 {
		t.Errorf("a machine that stayed up kept its count: %d", service.restarts)
	}
	machine.running = false
	clock.advance(restartCap)
	if state := service.tick(context.Background()); !state.Running || service.gaveUp {
		t.Errorf("a machine that stayed up should still be restartable: %+v", state)
	}
}

// The reconcile: the release the product asked for is applied once, the state names it, and the
// same intent on the next tick is a no-op — an intent is idempotent, a request would not be.
func TestTheReleaseTheProductAsksForIsAppliedOnce(t *testing.T) {
	machine := &fakeMachine{}
	var applied []string
	var home string
	service, _, dir, root := newSupervisor(t, machine, func(_ context.Context, tag string) error {
		applied = append(applied, tag)
		// The real apply leaves the disk for that release: the next tick must see it.
		makeRunningDisk(t, home, tag)
		return nil
	})
	home = dir
	makeRunningDisk(t, home, "v0.10.0-beta.13")
	machine.running = true
	if err := update.WriteWant(root, "v0.10.0-beta.14"); err != nil {
		t.Fatal(err)
	}
	state := service.tick(context.Background())
	if len(applied) != 1 || applied[0] != "v0.10.0-beta.14" {
		t.Fatalf("applied %v", applied)
	}
	if state.Version != "v0.10.0-beta.14" {
		t.Errorf("state version = %q", state.Version)
	}
	service.tick(context.Background())
	if len(applied) != 1 {
		t.Errorf("the same intent was applied twice: %v", applied)
	}
}

// An apply that fails leaves the machine that is running exactly as it is, names the failure, and
// does not hammer the release source once a second.
func TestAFailedApplyLeavesTheMachineAloneAndIsNotRetriedEverySecond(t *testing.T) {
	machine := &fakeMachine{}
	attempts := 0
	service, clock, home, root := newSupervisor(t, machine, func(context.Context, string) error {
		attempts++
		return errors.New("no route to the release")
	})
	makeRunningDisk(t, home, "v0.10.0-beta.13")
	machine.running = true
	if err := update.WriteWant(root, "v0.10.0-beta.14"); err != nil {
		t.Fatal(err)
	}
	state := service.tick(context.Background())
	if attempts != 1 {
		t.Fatalf("attempts = %d", attempts)
	}
	if !state.Running || state.Version != "v0.10.0-beta.13" {
		t.Errorf("the machine that was running is gone or changed: %+v", state)
	}
	if !strings.Contains(state.LastError, "no route to the release") {
		t.Errorf("the failure is not in the state: %q", state.LastError)
	}
	clock.advance(serveInterval)
	service.tick(context.Background())
	if attempts != 1 {
		t.Errorf("a failed apply was retried a second later: %d attempts", attempts)
	}
	clock.advance(applyRetry)
	service.tick(context.Background())
	if attempts != 2 {
		t.Errorf("a failed apply was not retried after its delay: %d attempts", attempts)
	}
}

// A want.json the service refuses is named in the state and nothing is fetched: the mount's writer
// gets the sentence, and the machine that is running is not touched.
func TestAWantThatIsNotAReleaseIsRefusedByName(t *testing.T) {
	machine := &fakeMachine{}
	applied := 0
	service, _, home, root := newSupervisor(t, machine, func(context.Context, string) error {
		applied++
		return nil
	})
	makeRunningDisk(t, home, "v0.10.0-beta.13")
	machine.running = true
	if err := os.MkdirAll(update.HostDir(root), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(update.WantPath(root), []byte(`{"version":"../../etc/passwd"}`), 0o644); err != nil {
		t.Fatal(err)
	}
	state := service.tick(context.Background())
	if applied != 0 {
		t.Errorf("a value that did not parse was applied: %d", applied)
	}
	if !strings.Contains(state.LastError, "not a release tag") {
		t.Errorf("the refusal does not name what is wrong: %q", state.LastError)
	}
	if state.Version != "v0.10.0-beta.13" {
		t.Errorf("state version = %q", state.Version)
	}
}

// Nothing declared changes nothing: the machine is kept running and the release it has is left.
func TestNothingWantedChangesNothing(t *testing.T) {
	machine := &fakeMachine{}
	applied := 0
	service, _, home, root := newSupervisor(t, machine, func(context.Context, string) error {
		applied++
		return nil
	})
	_ = root
	makeRunningDisk(t, home, "v0.10.0-beta.13")
	machine.running = true
	state := service.tick(context.Background())
	if applied != 0 || machine.boots != 0 {
		t.Errorf("applied = %d, boots = %d", applied, machine.boots)
	}
	if !state.Running || state.Version != "v0.10.0-beta.13" || state.LastError != "" {
		t.Errorf("state = %+v", state)
	}
}

// The state names the service's own build and is stamped: an is.json without a time is a screen
// that cannot say how old the answer is.
func TestTheStateNamesTheServiceAndWhenItWasWritten(t *testing.T) {
	machine := &fakeMachine{}
	service, clock, home, _ := newSupervisor(t, machine, nil)
	makeRunningDisk(t, home, "v0.10.0-beta.13")
	state := service.tick(context.Background())
	if state.Service != "v0.10.0-beta.14" {
		t.Errorf("service = %q", state.Service)
	}
	if want := update.StampedAt(clock.now()); state.At != want {
		t.Errorf("at = %q, want %q", state.At, want)
	}
}

// The backoff is a table, because it is the one number that decides how often a broken machine is
// asked to come back.
func TestTheRestartBackoffGrowsAndIsCapped(t *testing.T) {
	for _, c := range []struct {
		restarts int
		want     time.Duration
	}{
		{0, time.Second},
		{1, time.Second},
		{2, 2 * time.Second},
		{3, 4 * time.Second},
		{4, 8 * time.Second},
		{5, 16 * time.Second},
		{6, 32 * time.Second},
		{7, restartCap},
		{40, restartCap},
	} {
		if got := backoff(c.restarts); got != c.want {
			t.Errorf("backoff(%d) = %s, want %s", c.restarts, got, c.want)
		}
	}
}

// An install with nothing here is made from this build's release, which is the first boot `machine
// up` does; one that has a disk is left alone.
func TestAnInstallWithNothingHereIsMadeFromThisBuildsRelease(t *testing.T) {
	home := t.TempDir()
	original := fetchApplianceTarball
	t.Cleanup(func() { fetchApplianceTarball = original })
	fetched := ""
	fetchApplianceTarball = func(_ context.Context, _ string, tag string, _ bool) (string, error) {
		fetched = tag
		return "", errors.New("no route to the release")
	}
	if _, err := applianceUp(context.Background(), home, "v0.10.0-beta.14"); err == nil {
		t.Fatal("nothing here and no network must fail, not invent a machine")
	}
	if fetched != "v0.10.0-beta.14" {
		t.Errorf("fetched %q", fetched)
	}

	makeRunningDisk(t, home, "v0.10.0-beta.13")
	image, err := applianceUp(context.Background(), home, "v0.10.0-beta.13")
	if err != nil {
		t.Fatal(err)
	}
	if image != applianceDisk(home) {
		t.Errorf("image = %q", image)
	}
	if fetched != "v0.10.0-beta.14" {
		t.Errorf("a disk that is here fetched the release again: %q", fetched)
	}
}

// The version the channel reports is the disk's own record, then the mark of an image from before
// the layout — the file a person reads, not what the image claims about itself.
func TestTheRunningVersionIsTheDisksRecord(t *testing.T) {
	home := t.TempDir()
	if got := applianceRunningVersion(home); got != "" {
		t.Errorf("nothing here is no version, got %q", got)
	}
	writeApplianceFiles(t, legacyAppliance(home), releaseMark("v0.10.0-beta.12"))
	if got := applianceRunningVersion(home); got != "v0.10.0-beta.12" {
		t.Errorf("the image from before the layout says %q", got)
	}
	makeRunningDisk(t, home, "v0.10.0-beta.13")
	if got := applianceRunningVersion(home); got != "v0.10.0-beta.13" {
		t.Errorf("the disk's record wins, got %q", got)
	}
}

// An update is a new disk made beside the live one and swapped in: the machine is taken away only
// after the new disk is complete, and the artifact stays.
func TestApplyingAReleaseMakesANewDiskAndKeepsTheArtifact(t *testing.T) {
	home := t.TempDir()
	makeRunningDisk(t, home, "v0.10.0-beta.13")
	original := fetchApplianceTarball
	t.Cleanup(func() { fetchApplianceTarball = original })
	fetchApplianceTarball = func(context.Context, string, string, bool) (string, error) {
		return "", errors.New("no route to the release")
	}
	machine := &fakeMachine{running: true}
	// A person has declared the machine running, so this is the apply that fetches: a release that
	// cannot be fetched is the failure this test is about.
	root := t.TempDir()
	if err := update.WriteMachineIntent(root, update.IntentRunning); err != nil {
		t.Fatal(err)
	}
	if err := applyRelease(context.Background(), home, root, machine, "v0.10.0-beta.14"); err == nil {
		t.Fatal("a release that cannot be fetched must fail")
	}
	if machine.removes != 0 {
		t.Errorf("the machine was taken away before the new disk was ready: %d removals", machine.removes)
	}
	if got := applianceRunningVersion(home); got != "v0.10.0-beta.13" {
		t.Errorf("a failed apply changed the disk: %q", got)
	}
	if err := applyRelease(context.Background(), home, root, machine, "../../etc/passwd"); err == nil {
		t.Error("a value that is not a release must be refused")
	}
	if _, err := os.Stat(filepath.Join(home, "appliance")); err == nil {
		t.Errorf("a refused apply touched the artifact folder")
	}
}

// The person's declaration is the only thing that says whether a machine should exist, and `machine
// down` writes it before it removes anything. The service read no such file when it started the
// machine again a second after a person took it down, which made `down` a lie whenever it ran.
func TestDownIsNotUndoneByTheService(t *testing.T) {
	machine := &fakeMachine{}
	service, _, _, root := newSupervisor(t, machine, nil)
	if err := update.WriteMachineIntent(root, update.IntentGone); err != nil {
		t.Fatal(err)
	}
	state := service.tick(context.Background())
	if machine.boots != 0 {
		t.Fatalf("a machine a person took down was started: %d boots", machine.boots)
	}
	if state.Running {
		t.Errorf("the state claims a running machine: %+v", state)
	}
	// And it stays that way: the next tick is not a second opinion.
	service.tick(context.Background())
	if machine.boots != 0 {
		t.Errorf("the second tick started it: %d boots", machine.boots)
	}
}

// The same for `stop`: the record and the disk stay, and the service leaves it stopped.
func TestStopIsNotUndoneByTheService(t *testing.T) {
	machine := &fakeMachine{}
	service, _, home, root := newSupervisor(t, machine, nil)
	makeRunningDisk(t, home, "v0.10.0-beta.13")
	if err := update.WriteMachineIntent(root, update.IntentStopped); err != nil {
		t.Fatal(err)
	}
	state := service.tick(context.Background())
	if machine.boots != 0 {
		t.Fatalf("a stopped machine was started: %d boots", machine.boots)
	}
	if state.Running || state.Version != "v0.10.0-beta.13" {
		t.Errorf("a stopped machine still says what it is, and is not running: %+v", state)
	}
}

// A declaration of `running` is what the service acts on: the machine comes up, and it comes back
// after an exit because the file still says so.
func TestTheServiceStartsAMachineThatIsPinned(t *testing.T) {
	machine := &fakeMachine{}
	service, clock, _, _ := newSupervisor(t, machine, nil)
	state := service.tick(context.Background())
	if machine.boots != 1 || !state.Running {
		t.Fatalf("a machine declared running was not started: boots=%d state=%+v", machine.boots, state)
	}
	machine.running = false
	clock.advance(restartCap)
	if state := service.tick(context.Background()); machine.boots != 2 || !state.Running {
		t.Errorf("the pin did not bring it back: boots=%d state=%+v", machine.boots, state)
	}
}

// No file is a host where a person drives, which is what an install was before there was a service:
// the machine is neither made nor started, and nothing is reported as broken.
func TestNoDeclarationStartsNothing(t *testing.T) {
	machine := &fakeMachine{}
	service, _, home, root := newSupervisor(t, machine, nil)
	if err := os.Remove(update.MachineIntentPath(root)); err != nil {
		t.Fatal(err)
	}
	state := service.tick(context.Background())
	if machine.boots != 0 {
		t.Errorf("a host with no declaration was started by the service: %d boots", machine.boots)
	}
	if state.Running {
		t.Errorf("state = %+v", state)
	}
	if state.LastError != "" {
		t.Errorf("no declaration is not an error: %q", state.LastError)
	}
	if _, err := os.Stat(applianceDisk(home)); err == nil {
		t.Errorf("the service made a disk nobody asked for")
	}
}

// A file the service cannot read is the same answer as no file: nothing is started, and the loop
// keeps ticking rather than dying on it.
func TestAnUnparseableDeclarationStartsNothing(t *testing.T) {
	machine := &fakeMachine{}
	service, clock, _, root := newSupervisor(t, machine, nil)
	if err := os.MkdirAll(filepath.Dir(update.MachineIntentPath(root)), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, payload := range []string{"{not json", `{"wanted":"maybe"}`, "   "} {
		if err := os.WriteFile(update.MachineIntentPath(root), []byte(payload), 0o644); err != nil {
			t.Fatal(err)
		}
		state := service.tick(context.Background())
		if machine.boots != 0 {
			t.Fatalf("%q started the machine", payload)
		}
		if state.Running || state.LastError != "" {
			t.Errorf("%q: state = %+v", payload, state)
		}
		clock.advance(serveInterval)
	}
}

// A restart is a deliberate start: the declaration is `running` before the down half, so a failure
// between the two halves leaves a machine the service keeps up rather than one it thinks was taken
// down.
func TestRestartKeepsTheMachinePinned(t *testing.T) {
	root := t.TempDir()
	var order []string
	down := func([]string) {
		order = append(order, "down")
		if got := update.ReadMachineIntent(root); got != update.IntentRunning {
			t.Errorf("the down half ran with %q declared, so a failure there would leave a machine nobody restarts", got)
		}
	}
	up := func([]string) { order = append(order, "up") }
	restartMachine([]string{"--root", root}, down, up)
	if got, want := strings.Join(order, ","), "down,up"; got != want {
		t.Errorf("restart did %q, want %q", got, want)
	}
	if got := update.ReadMachineIntent(root); got != update.IntentRunning {
		t.Errorf("after a restart the declaration is %q, want running", got)
	}
	// The flags a person passes are the flags the declaration reads, whatever order they come in.
	if got := rootFromFlags([]string{"--home", "/tmp/h", "--root", root}); got != root {
		t.Errorf("rootFromFlags read %q, want %q", got, root)
	}
	if got := rootFromFlags([]string{"--root=" + root}); got != root {
		t.Errorf("rootFromFlags read %q from --root=..., want %q", got, root)
	}
	if got := rootFromFlags([]string{"--home", "/tmp/h"}); got != "" {
		t.Errorf("no --root is the default root, got %q", got)
	}
}

// applianceTarball is a rootfs tarball with one file in it, for the tests that need an unpack that
// works: the real artifact is 155 MB, and the shape is what matters here, not the size.
func applianceTarball(t *testing.T) string {
	t.Helper()
	path := filepath.Join(t.TempDir(), "appliance.tar.gz")
	file, err := os.Create(path)
	if err != nil {
		t.Fatal(err)
	}
	compressed := gzip.NewWriter(file)
	tarball := tar.NewWriter(compressed)
	body := []byte("#!/bin/sh\n")
	if err := tarball.WriteHeader(&tar.Header{Name: "usr/local/bin/acornfall", Typeflag: tar.TypeReg, Mode: 0o755, Size: int64(len(body))}); err != nil {
		t.Fatal(err)
	}
	if _, err := tarball.Write(body); err != nil {
		t.Fatal(err)
	}
	if err := tarball.Close(); err != nil {
		t.Fatal(err)
	}
	if err := compressed.Close(); err != nil {
		t.Fatal(err)
	}
	if err := file.Close(); err != nil {
		t.Fatal(err)
	}
	return path
}

// A machine a person took down is given no body: `gone` says the machine is not here, and a 575 MB
// tree made a second later is the same lie smaller — the person asked for it to be gone and would
// find a tree where they expected nothing. The fetch is what makes the tree, so it must not happen.
func TestAnUpdateForAGoneMachineMakesNoDisk(t *testing.T) {
	for _, c := range []struct {
		name   string
		intent update.Intent
	}{
		{"gone", update.IntentGone},
		{"stopped", update.IntentStopped},
	} {
		t.Run(c.name, func(t *testing.T) {
			home := t.TempDir()
			root := t.TempDir()
			if err := update.WriteMachineIntent(root, c.intent); err != nil {
				t.Fatal(err)
			}
			if err := update.WriteWant(root, "v0.10.0-beta.14"); err != nil {
				t.Fatal(err)
			}
			original := fetchApplianceTarball
			t.Cleanup(func() { fetchApplianceTarball = original })
			fetches := 0
			fetchApplianceTarball = func(context.Context, string, string, bool) (string, error) {
				fetches++
				return applianceTarball(t), nil
			}
			machine := &fakeMachine{running: true}
			if err := applyRelease(context.Background(), home, root, machine, "v0.10.0-beta.14"); err != nil {
				t.Fatalf("keeping a request is not a failure: %v", err)
			}
			if fetches != 0 {
				t.Errorf("a %s machine fetched %d times", c.name, fetches)
			}
			if _, err := os.Stat(applianceDisk(home)); err == nil {
				t.Errorf("a disk was made for a %s machine", c.name)
			}
			if machine.removes != 0 || machine.boots != 0 {
				t.Errorf("a %s machine was taken away or booted: removes=%d boots=%d", c.name, machine.removes, machine.boots)
			}
			// The product's request is kept, not cleared, dropped or rewritten.
			if want, err := update.ReadWant(root); err != nil || want.Version != "v0.10.0-beta.14" {
				t.Errorf("the request was not kept: %+v, %v", want, err)
			}
		})
	}
}

// When a person says `up`, the request that waited is applied on the next tick with no new code:
// want.json was never touched, and the reconcile reads it again. This drives the real apply, so it
// is the whole path — fetch, unpack, swap, boot — and not a stub of it.
func TestAnUpdateHeldWhileDownIsAppliedWhenTheMachineIsUp(t *testing.T) {
	machine := &fakeMachine{}
	var home string
	var root string
	var service *supervisor
	var clock *fakeClock
	service, clock, home, root = newSupervisor(t, machine, func(ctx context.Context, tag string) error {
		return applyRelease(ctx, home, root, machine, tag)
	})
	if err := update.WriteMachineIntent(root, update.IntentGone); err != nil {
		t.Fatal(err)
	}
	if err := update.WriteWant(root, "v0.10.0-beta.14"); err != nil {
		t.Fatal(err)
	}
	original := fetchApplianceTarball
	t.Cleanup(func() { fetchApplianceTarball = original })
	fetches := 0
	fetchApplianceTarball = func(context.Context, string, string, bool) (string, error) {
		fetches++
		return applianceTarball(t), nil
	}
	if state := service.tick(context.Background()); fetches != 0 || state.Running {
		t.Fatalf("a gone machine applied the request: fetches=%d state=%+v", fetches, state)
	}
	// A person says up: the machine comes back on the release that is here, and the request that was
	// held is what the next tick applies.
	if err := update.WriteMachineIntent(root, update.IntentRunning); err != nil {
		t.Fatal(err)
	}
	clock.advance(restartCap)
	state := service.tick(context.Background())
	if fetches != 1 {
		t.Fatalf("the held request was not fetched after up: fetches=%d", fetches)
	}
	if state.Version != "v0.10.0-beta.14" || !state.Running || state.LastError != "" {
		t.Errorf("state = %+v", state)
	}
	if tag := applianceDiskTag(applianceDisk(home)); tag != "v0.10.0-beta.14" {
		t.Errorf("the disk is %q, want v0.10.0-beta.14", tag)
	}
	if want, err := update.ReadWant(root); err != nil || want.Version != "v0.10.0-beta.14" {
		t.Errorf("the request was rewritten: %+v, %v", want, err)
	}
}
