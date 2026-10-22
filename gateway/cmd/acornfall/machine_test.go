package main

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/acornfall/acornfall/gateway/internal/update"
)

// What the machine runs as its init, pinned: the product out of the image, the mount as its
// world, and its containers as this machine's own. No provider and no model appear here — they
// come from the mount, which is what lets the machine be replaced without losing the product.
func TestTheMachineRunsTheApplianceAsItsInit(t *testing.T) {
	start := applianceInit("/home/me/acornfall", "sekrit")
	for _, want := range []string{
		"exec /usr/local/bin/acornfall",
		"--addr 0.0.0.0:7777 --token sekrit",
		"--root /home/me/acornfall",
		"--home /var/lib/acornfall",
		"--workspace /home/me/acornfall/workspaces/general",
		"--worker-dir /usr/local/lib/acornfall/worker",
		"--sandbox-engine lxc --in-machine",
		">>/var/lib/acornfall/appliance.log 2>&1",
	} {
		if !strings.Contains(start, want) {
			t.Errorf("want %q in the init:\n%s", want, start)
		}
	}
	for _, forbidden := range []string{"ACORNFALL_DEV_PROVIDER", "--model", "--credentials"} {
		if strings.Contains(start, forbidden) {
			t.Errorf("%q belongs to the mount, not to the machine's init:\n%s", forbidden, start)
		}
	}
}

// An image that is not an appliance is refused by name, because the engine's own error for a
// missing rootfs ("failed to start") says nothing about what to do.
func TestAnImageThatIsNotAnApplianceIsRefusedByName(t *testing.T) {
	empty := t.TempDir()
	err := checkAppliance(empty)
	if err == nil || !strings.Contains(err.Error(), "not an appliance image") {
		t.Fatalf("want a refusal naming the image, got %v", err)
	}
	good := t.TempDir()
	for _, path := range []string{"usr/local/bin/acornfall", "usr/local/lib/acornfall/worker/src/main.ts"} {
		target := filepath.Join(good, path)
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(target, []byte("#!/bin/sh\n"), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := checkAppliance(good); err != nil {
		t.Fatalf("an appliance image should be accepted: %v", err)
	}
}

// Without a token in the mount the port answers unauthenticated, which is only acceptable
// because it is published on loopback: the init says which of the two it is, and never both.
func TestTheApplianceUsesTheMountsTokenOrNothing(t *testing.T) {
	withToken := applianceInit("/home/me/acornfall", "sekrit")
	if !strings.Contains(withToken, "--token sekrit") || strings.Contains(withToken, "--insecure") {
		t.Errorf("a token in the mount is what the port answers with:\n%s", withToken)
	}
	without := applianceInit("/home/me/acornfall", "")
	if !strings.Contains(without, "--insecure") || strings.Contains(without, "--token") {
		t.Errorf("no token is the loopback case, and it says so:\n%s", without)
	}
}

// The URL a person is told to open is one a browser can open: the wildcard is not an address, and
// an IPv6 literal without brackets names a port instead of an address.
func TestTheConsoleURLIsOneABrowserCanOpen(t *testing.T) {
	for _, c := range []struct {
		host string
		port int
		want string
	}{
		{"127.0.0.1", 7777, "http://127.0.0.1:7777"},
		{"0.0.0.0", 7777, "http://127.0.0.1:7777"},
		{"::", 7777, "http://127.0.0.1:7777"},
		{"", 7777, "http://127.0.0.1:7777"},
		{"::1", 7777, "http://[::1]:7777"},
		{"100.64.1.2", 8080, "http://100.64.1.2:8080"},
	} {
		if got := consoleURL(c.host, c.port); got != c.want {
			t.Errorf("consoleURL(%q, %d) = %q, want %q", c.host, c.port, got, c.want)
		}
	}
}

// The notice is the whole warning: silent on loopback, and never claiming there is no
// authentication over an install that carries a token — a false warning is one people learn to skip.
func TestPublishingOffLoopbackSaysWhatIsTrue(t *testing.T) {
	for _, host := range []string{"127.0.0.1", "127.0.0.2", "::1", "localhost"} {
		for _, authenticated := range []bool{false, true} {
			if notice := publishNotice(host, 7777, authenticated); notice != "" {
				t.Errorf("publishing on loopback (%q) needs no notice, got %q", host, notice)
			}
		}
	}
	open := publishNotice("0.0.0.0", 7777, false)
	if !strings.Contains(open, "0.0.0.0:7777") || !strings.Contains(open, "no authentication") {
		t.Errorf("a wildcard publish names its host and port and the missing authentication: %q", open)
	}
	guarded := publishNotice("0.0.0.0", 7777, true)
	if strings.Contains(guarded, "no authentication") || !strings.Contains(guarded, "token") {
		t.Errorf("an install with a token does not lack authentication: %q", guarded)
	}
}

// An image is the release it says it is, and one that says nothing is from before the mark
// carried a release. Both matter: the launcher used to keep any image whose two files were there,
// so an upgrade booted the previous appliance and the containers on it — which is how every
// workspace came to say it had no sandbox.
func TestTheImageIsTheReleaseThisBuildRuns(t *testing.T) {
	for _, c := range []struct {
		name  string
		mark  string
		tag   string
		given bool
		want  bool
	}{
		{"the image this build fetched", "acornfall appliance v0.10.0-beta.12, debian stable, lxc 6.0.4", "v0.10.0-beta.12", false, true},
		{"an older one", "acornfall appliance v0.10.0-beta.11, debian stable, lxc 6.0.4", "v0.10.0-beta.12", false, false},
		{"built before the mark carried a release", "acornfall appliance, debian stable, lxc 6.0.4", "v0.10.0-beta.12", false, false},
		{"no mark at all", "", "v0.10.0-beta.12", false, false},
		{"the person named this image", "acornfall appliance, debian stable, lxc 6.0.4", "v0.10.0-beta.12", true, true},
		{"a source build has no release to be", "acornfall appliance, debian stable, lxc 6.0.4", "dev", false, true},
		{"a source build keeps a stamped image too", "acornfall appliance v0.10.0-beta.12, debian stable, lxc 6.0.4", "", false, true},
	} {
		image := t.TempDir()
		if c.mark != "" {
			path := filepath.Join(image, applianceMark)
			if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
				t.Fatal(err)
			}
			if err := os.WriteFile(path, []byte(c.mark+"\n"), 0o644); err != nil {
				t.Fatal(err)
			}
		}
		if got := applianceCurrent(image, c.tag, c.given); got != c.want {
			t.Errorf("%s: applianceCurrent(%q, given=%v) = %v, want %v", c.name, c.tag, c.given, got, c.want)
		}
	}
}

// Stamping keeps what the build said about the image and replaces only the release: the mark is
// what a person reads to know which appliance they have.
func TestStampingAnImageNamesItsRelease(t *testing.T) {
	image := t.TempDir()
	if err := os.MkdirAll(filepath.Join(image, "etc"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(image, applianceMark), []byte("acornfall appliance, debian stable, lxc 6.0.4\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := stampAppliance(image, "v0.10.0-beta.12"); err != nil {
		t.Fatal(err)
	}
	payload, err := os.ReadFile(filepath.Join(image, applianceMark))
	if err != nil {
		t.Fatal(err)
	}
	if got, want := string(payload), "acornfall appliance v0.10.0-beta.12, debian stable, lxc 6.0.4\n"; got != want {
		t.Errorf("mark = %q, want %q", got, want)
	}
	if version := applianceVersion(image); version != "v0.10.0-beta.12" {
		t.Errorf("the version reads back as %q", version)
	}
}

// An image with no mark is stamped with the release alone rather than with a base nobody measured.
func TestStampingAnImageWithNoMarkInventsNothing(t *testing.T) {
	image := t.TempDir()
	if err := stampAppliance(image, "v0.10.0-beta.12"); err != nil {
		t.Fatal(err)
	}
	payload, err := os.ReadFile(filepath.Join(image, applianceMark))
	if err != nil {
		t.Fatal(err)
	}
	if got, want := string(payload), "acornfall appliance v0.10.0-beta.12\n"; got != want {
		t.Errorf("mark = %q, want %q", got, want)
	}
}

// An image from another release is replaced, and a fetch that cannot happen must not take a
// machine that is already there down with it: an offline install keeps what it boots. The image
// then says it is the wrong release, which is a sentence a person can act on.
func TestAFailedFetchKeepsTheImageThatIsThere(t *testing.T) {
	image := t.TempDir()
	for _, path := range []string{"usr/local/bin/acornfall", "usr/local/lib/acornfall/worker/src/main.ts"} {
		target := filepath.Join(image, path)
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(target, []byte("#!/bin/sh\n"), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	fetched := false
	original := fetchAppliance
	fetchAppliance = func(context.Context, string, string, string) error {
		fetched = true
		return errors.New("no route to the release")
	}
	t.Cleanup(func() { fetchAppliance = original })

	if err := ensureAppliance(context.Background(), t.TempDir(), image, false, false, "v0.10.0-beta.13"); err != nil {
		t.Fatalf("an image that is there should still boot: %v", err)
	}
	if !fetched {
		t.Fatal("the launcher should have tried the fetch: the image does not say which release it is")
	}

	// With no image there is nothing to boot, so the failure is the answer.
	empty := t.TempDir()
	if err := ensureAppliance(context.Background(), t.TempDir(), empty, false, false, "v0.10.0-beta.13"); err == nil {
		t.Error("a missing image cannot be booted, so the fetch failure is fatal")
	}
}

// Whether the image is replaced, and nothing else: a refresh always, a missing or broken image
// always, an image from another release yes, and the two trees this launcher does not own no.
func TestWhenTheImageIsReplaced(t *testing.T) {
	good := t.TempDir()
	for _, path := range []string{"usr/local/bin/acornfall", "usr/local/lib/acornfall/worker/src/main.ts"} {
		target := filepath.Join(good, path)
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(target, []byte("#!/bin/sh\n"), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if err := stampAppliance(good, "v0.10.0-beta.13"); err != nil {
		t.Fatal(err)
	}
	empty := t.TempDir()

	for _, c := range []struct {
		name    string
		image   string
		tag     string
		refresh bool
		given   bool
		want    bool
	}{
		{"the release this build runs", good, "v0.10.0-beta.13", false, false, false},
		{"another release", good, "v0.10.0-beta.14", false, false, true},
		{"a refresh asks for it", good, "v0.10.0-beta.13", true, false, true},
		{"nothing there to boot", empty, "v0.10.0-beta.13", false, false, true},
		{"a named image is the person's", good, "v0.10.0-beta.14", false, true, false},
		{"a named image that is not one is still fetched", empty, "v0.10.0-beta.13", false, true, true},
	} {
		if got := applianceWillReplace(c.image, c.tag, c.refresh, c.given); got != c.want {
			t.Errorf("%s: applianceWillReplace = %v, want %v", c.name, got, c.want)
		}
	}
}

// writeApplianceFiles makes dir pass checkAppliance, and writes mark into it when one is given.
func writeApplianceFiles(t *testing.T, dir, mark string) {
	t.Helper()
	for _, path := range []string{"usr/local/bin/acornfall", "usr/local/lib/acornfall/worker/src/main.ts"} {
		target := filepath.Join(dir, path)
		if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(target, []byte("#!/bin/sh\n"), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	if mark != "" {
		path := filepath.Join(dir, applianceMark)
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, []byte(mark+"\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
}

// makeDisk lays out the disk this layout makes for home, as `machine up` would have left it.
func makeDisk(t *testing.T, home, tag string) string {
	t.Helper()
	disk := applianceDisk(home)
	writeApplianceFiles(t, disk, "")
	if err := writeApplianceDiskTag(disk, tag); err != nil {
		t.Fatal(err)
	}
	return disk
}

func releaseMark(tag string) string {
	return "acornfall appliance " + tag + ", debian stable, lxc 6.0.4"
}

// The artifact is the tarball and the disk is made from it (ADR 0026, amended), so which directory
// the machine boots is decided in one place: the disk for the release this launcher runs, then the
// image directory an install had before this layout, then the release's tarball unpacked into a new
// disk. Every row here was a bug in the shape this replaced: one directory was both the artifact
// and the live disk, so an upgrade booted the previous appliance and the containers on it.
func TestTheMachineBootsTheDiskItsTarballMade(t *testing.T) {
	const release = "v0.10.0-beta.14"
	const older = "v0.10.0-beta.13"
	for _, c := range []struct {
		name       string
		diskTag    string // "" is no disk at all
		legacyMark string // "" is no image directory from before this layout
		refresh    bool
		wantLegacy bool
		wantUnpack bool
	}{
		{name: "a disk made for this release is the machine", diskTag: release},
		{name: "a disk made for another release is made again", diskTag: older, wantUnpack: true},
		{name: "a disk with no release beside it is not this release's", diskTag: "untagged", wantUnpack: true},
		{name: "an install from before the layout boots the image it has", legacyMark: releaseMark(release), wantLegacy: true},
		{name: "an older image is left alone and a disk is made beside it", legacyMark: releaseMark(older), wantUnpack: true},
		{name: "an image that says nothing is left alone too", legacyMark: "acornfall appliance, debian stable, lxc 6.0.4", wantUnpack: true},
		{name: "a refresh makes a new disk even for the same release", diskTag: release, legacyMark: releaseMark(release), refresh: true, wantUnpack: true},
		{name: "nothing here is a disk to make", wantUnpack: true},
	} {
		t.Run(c.name, func(t *testing.T) {
			home := t.TempDir()
			disk := ""
			if c.diskTag != "" {
				disk = makeDisk(t, home, c.diskTag)
			}
			if c.legacyMark != "" {
				writeApplianceFiles(t, legacyAppliance(home), c.legacyMark)
			}
			plan := applianceLayoutFor(home, release, c.refresh)
			switch {
			case c.wantUnpack:
				if !plan.Unpack {
					t.Fatalf("want a new disk, got %+v", plan)
				}
				if want := applianceDisk(home); plan.Image != want {
					t.Errorf("the disk is %q, want %q", plan.Image, want)
				}
				if want := update.ApplianceTarball(home, release); plan.Tarball != want {
					t.Errorf("the artifact is %q, want %q", plan.Tarball, want)
				}
			case c.wantLegacy:
				if plan.Unpack || !plan.Legacy {
					t.Fatalf("want the image this install has, got %+v", plan)
				}
				if want := legacyAppliance(home); plan.Image != want {
					t.Errorf("the image is %q, want %q", plan.Image, want)
				}
			default:
				if plan.Unpack || plan.Legacy {
					t.Fatalf("want the disk that is already made, got %+v", plan)
				}
				if plan.Image != disk {
					t.Errorf("the disk is %q, want %q", plan.Image, disk)
				}
			}
		})
	}
}

// The image directory an install already has is never deleted and never written into: it is what
// boots when a fetch cannot happen, and a change that replaced it would take away the one machine a
// person has. A new release makes a new disk beside it, and `machine down` leaves it alone.
func TestTheImageAnInstallAlreadyHasIsNeverTouched(t *testing.T) {
	home := t.TempDir()
	legacy := legacyAppliance(home)
	writeApplianceFiles(t, legacy, releaseMark("v0.10.0-beta.13"))
	container := filepath.Join(legacy, "var", "lib", "lxc", "web", "config")
	if err := os.MkdirAll(filepath.Dir(container), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(container, []byte("a container a previous machine left\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	if plan := applianceLayoutFor(home, "v0.10.0-beta.14", false); !plan.Unpack || plan.Image == legacy {
		t.Fatalf("a new release makes a new disk, not an edit of this one: %+v", plan)
	}
	if removed, err := removeMachineDisk(home, legacy); err != nil || removed {
		t.Fatalf("the old image is not ours to delete: removed=%v err=%v", removed, err)
	}
	if body, err := os.ReadFile(container); err != nil {
		t.Fatalf("the old image was touched: %v", err)
	} else if string(body) != "a container a previous machine left\n" {
		t.Errorf("the old image holds %q", body)
	}
}

// `machine down` takes the disk and keeps the artifact: the tarball is what a machine is made of, so
// the next up is a copy rather than a download, and an install with no network can still boot.
func TestTakingTheMachineDownKeepsTheArtifact(t *testing.T) {
	home := t.TempDir()
	disk := makeDisk(t, home, "v0.10.0-beta.14")
	tarball := update.ApplianceTarball(home, "v0.10.0-beta.14")
	if err := os.MkdirAll(filepath.Dir(tarball), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(tarball, []byte("the release's bytes"), 0o644); err != nil {
		t.Fatal(err)
	}

	removed, err := removeMachineDisk(home, disk)
	if err != nil || !removed {
		t.Fatalf("the disk is the machine's and goes with it: removed=%v err=%v", removed, err)
	}
	if _, err := os.Stat(disk); !os.IsNotExist(err) {
		t.Errorf("the disk is still there: %v", err)
	}
	if body, err := os.ReadFile(tarball); err != nil {
		t.Fatalf("the artifact went with the disk: %v", err)
	} else if string(body) != "the release's bytes" {
		t.Errorf("the artifact holds %q", body)
	}
	if removed, err := removeMachineDisk(home, t.TempDir()); err != nil || removed {
		t.Errorf("a tree a person named is not ours to delete: removed=%v err=%v", removed, err)
	}
}

// A fetch that cannot happen must not leave an install that cannot start: what is here boots, and
// the line says which release it is instead of pretending it is the one that was asked for.
func TestAFetchThatCannotHappenBootsWhatIsHere(t *testing.T) {
	original := fetchApplianceTarball
	fetchApplianceTarball = func(context.Context, string, string, bool) (string, error) {
		return "", errors.New("no route to the release")
	}
	t.Cleanup(func() { fetchApplianceTarball = original })

	home := t.TempDir()
	legacy := legacyAppliance(home)
	writeApplianceFiles(t, legacy, releaseMark("v0.10.0-beta.13"))
	plan := applianceLayoutFor(home, "v0.10.0-beta.14", false)
	image, err := makeApplianceDisk(context.Background(), home, "v0.10.0-beta.14", plan, false)
	if err != nil {
		t.Fatalf("an image that is here should still boot: %v", err)
	}
	if image != legacy {
		t.Errorf("booting %q, want the image that is here (%q)", image, legacy)
	}

	// With nothing here there is nothing to boot, so the failure is the answer.
	empty := t.TempDir()
	plan = applianceLayoutFor(empty, "v0.10.0-beta.14", false)
	if _, err := makeApplianceDisk(context.Background(), empty, "v0.10.0-beta.14", plan, false); err == nil {
		t.Error("a missing disk cannot be booted, so the fetch failure is fatal")
	}
}

// The two steps are ordered for a reason: a bad release may break the machine, and the host has to be
// there to fix it. So step 2 is taken only for a release step 1 proved, and a console that never
// answers stops the update between them with a sentence naming what was not done.
func TestTheUpdateStopsBetweenTheSteps(t *testing.T) {
	for _, c := range []struct {
		name        string
		machineOnly bool
		step1       error
		proves      bool
		step2       error
		wantSteps   string // the steps that ran, in order
		wantRefused string // a fragment the error must name, empty for success
	}{
		{name: "both steps", proves: true, wantSteps: "1,2"},
		{name: "the console never answers", wantSteps: "1", wantRefused: "step 2 (the host) was not taken"},
		{name: "the machine fails", step1: errors.New("no route to the release"), wantSteps: "1", wantRefused: "step 1 (the machine)"},
		{name: "the host fails", proves: true, step2: errors.New("the checksum does not match"), wantSteps: "1,2", wantRefused: "step 2 (the host)"},
		{name: "machine only", machineOnly: true, proves: true, wantSteps: "1"},
	} {
		t.Run(c.name, func(t *testing.T) {
			var ran []string
			step1 := func(context.Context, string) error {
				ran = append(ran, "1")
				return c.step1
			}
			prove := func(context.Context, string) bool {
				ran = append(ran, "prove")
				return c.proves
			}
			step2 := func(context.Context, string) error {
				ran = append(ran, "2")
				return c.step2
			}
			err := updateSteps(context.Background(), "v0.10.0-beta.14", c.machineOnly, step1, prove, step2)
			if c.wantRefused == "" {
				if err != nil {
					t.Fatalf("unexpected: %v", err)
				}
			} else if err == nil || !strings.Contains(err.Error(), c.wantRefused) {
				t.Fatalf("want a sentence naming %q, got %v", c.wantRefused, err)
			}
			var steps []string
			for _, step := range ran {
				if step != "prove" {
					steps = append(steps, step)
				}
			}
			if got := strings.Join(steps, ","); got != c.wantSteps {
				t.Errorf("steps %q, want %q", got, c.wantSteps)
			}
		})
	}
}
