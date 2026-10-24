package shim

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// The container trusts what the machine trusts. A test that read the real
// /etc/ssl/certs/ca-certificates.crt would be asserting something about the machine it runs on,
// so the path is pointed at a file the test owns.
func TestAContainerGetsTheMachinesRoots(t *testing.T) {
	machine := filepath.Join(t.TempDir(), "ca-certificates.crt")
	if err := os.WriteFile(machine, []byte("-----BEGIN CERTIFICATE-----\nmachine\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	was := caBundleInMachine
	caBundleInMachine = machine
	t.Cleanup(func() { caBundleInMachine = was })

	rootfs := t.TempDir()
	if err := certsFor(rootfs); err != nil {
		t.Fatal(err)
	}
	written, err := os.ReadFile(filepath.Join(rootfs, caBundleInContainer))
	if err != nil {
		t.Fatalf("the container has no bundle, so its first https request fails on the CA: %v", err)
	}
	if string(written) != "-----BEGIN CERTIFICATE-----\nmachine\n" {
		t.Errorf("the container's bundle is not the machine's: %q", written)
	}
}

// A machine built by hand has no bundle. The container then behaves exactly as it did before this
// existed, and a workspace is not taken down over a certificate it may never need.
func TestAMachineWithNoRootsIsNotAFailure(t *testing.T) {
	was := caBundleInMachine
	caBundleInMachine = filepath.Join(t.TempDir(), "there-is-no-bundle-here")
	t.Cleanup(func() { caBundleInMachine = was })

	rootfs := t.TempDir()
	if err := certsFor(rootfs); err != nil {
		t.Fatalf("a missing bundle failed the create: %v", err)
	}
	if _, err := os.Stat(filepath.Join(rootfs, caBundleInContainer)); !os.IsNotExist(err) {
		t.Error("a container was given a bundle that does not exist on the machine")
	}
}

// The one that costs an afternoon: without this line ssh(1) prints "No user exists for uid 999"
// and exits before it touches the network.
func TestAContainerGetsANameForTheUidItsToolsRunAs(t *testing.T) {
	rootfs := t.TempDir()
	etc := filepath.Join(rootfs, "etc")
	if err := os.MkdirAll(etc, 0o755); err != nil {
		t.Fatal(err)
	}
	image := "root:x:0:0:root:/root:/bin/bash\ndaemon:x:1:1:daemon:/usr/sbin:/usr/sbin/nologin\n"
	if err := os.WriteFile(filepath.Join(etc, "passwd"), []byte(image), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(etc, "group"), []byte("root:x:0:\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	if err := passwdFor(rootfs, "/srv/acornfall/workspaces/app", 999, 991); err != nil {
		t.Fatal(err)
	}

	passwd, err := os.ReadFile(filepath.Join(etc, "passwd"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.HasPrefix(string(passwd), image) {
		t.Errorf("the image's own entries were not kept:\n%s", passwd)
	}
	if !strings.Contains(string(passwd), "acornfall:x:999:991:acornfall:/srv/acornfall/workspaces/app:/bin/sh") {
		t.Errorf("no usable entry for the workspace's uid:\n%s", passwd)
	}
	group, err := os.ReadFile(filepath.Join(etc, "group"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(group), "acornfall:x:991:") {
		t.Errorf("the passwd line names a group /etc/group has never heard of:\n%s", group)
	}
}

// Creating a container twice is a thing that happens (a start that failed, a remake). The file is
// not the place to find out.
func TestTheSameUidIsNotNamedTwice(t *testing.T) {
	rootfs := t.TempDir()
	for range 3 {
		if err := passwdFor(rootfs, "/work", 999, 991); err != nil {
			t.Fatal(err)
		}
	}
	passwd, err := os.ReadFile(filepath.Join(rootfs, "etc", "passwd"))
	if err != nil {
		t.Fatal(err)
	}
	if got := strings.Count(string(passwd), "acornfall:x:"); got != 1 {
		t.Errorf("the entry was added %d times:\n%s", got, passwd)
	}
}

// An image that already names the uid keeps its own name: the container needs an answer for the
// uid, not this particular one.
func TestAnImageThatAlreadyNamesTheUidIsLeftAlone(t *testing.T) {
	rootfs := t.TempDir()
	etc := filepath.Join(rootfs, "etc")
	if err := os.MkdirAll(etc, 0o755); err != nil {
		t.Fatal(err)
	}
	image := "node:x:1000:1000:node:/home/node:/bin/sh\n"
	if err := os.WriteFile(filepath.Join(etc, "passwd"), []byte(image), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := passwdFor(rootfs, "/work", 1000, 1000); err != nil {
		t.Fatal(err)
	}
	passwd, err := os.ReadFile(filepath.Join(etc, "passwd"))
	if err != nil {
		t.Fatal(err)
	}
	if string(passwd) != image {
		t.Errorf("the image's own entry was added to:\n%s", passwd)
	}
}

// Root is the one uid no image has ever lacked.
func TestRootNeedsNoEntry(t *testing.T) {
	rootfs := t.TempDir()
	if err := passwdFor(rootfs, "/work", 0, 0); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(filepath.Join(rootfs, "etc", "passwd")); !os.IsNotExist(err) {
		t.Error("a file was written for root, who is already in every image")
	}
}

// A file whose last line has no newline would join itself to the new entry, and the entry we meant
// to add would be nobody's.
func TestAFileWithNoFinalNewlineIsNotJoined(t *testing.T) {
	rootfs := t.TempDir()
	etc := filepath.Join(rootfs, "etc")
	if err := os.MkdirAll(etc, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(etc, "passwd"), []byte("root:x:0:0:root:/root:/bin/sh"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := passwdFor(rootfs, "/work", 999, 991); err != nil {
		t.Fatal(err)
	}
	passwd, err := os.ReadFile(filepath.Join(etc, "passwd"))
	if err != nil {
		t.Fatal(err)
	}
	for _, line := range strings.Split(strings.TrimSuffix(string(passwd), "\n"), "\n") {
		if !strings.Contains(line, ":") || len(strings.Split(line, ":")) != 7 {
			t.Errorf("a line of /etc/passwd is not a passwd line: %q", line)
		}
	}
}

// The one beta 55 taught: a step that exists and is not called is a step that does not exist.
// This drives the real protocol with a faked runtime, and reads the rootfs the shim prepared.
func TestCreatingAContainerGivesItANameAndTheMachinesRoots(t *testing.T) {
	machine := filepath.Join(t.TempDir(), "ca-certificates.crt")
	if err := os.WriteFile(machine, []byte("roots\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	was := caBundleInMachine
	caBundleInMachine = machine
	t.Cleanup(func() { caBundleInMachine = was })

	ctx, cancel := callContext(t)
	defer cancel()
	client, _ := connected(t, &fakeRuntime{})
	dir := filepath.Join(t.TempDir(), "container")
	err := client.Create(ctx, CreatePayload{
		Name:   "app",
		Image:  "debian:stable-slim",
		Dir:    dir,
		Config: "lxc.uts.name = app\n",
		Owner:  999,
		Group:  991,
		Home:   "/srv/acornfall/workspaces/app",
	})
	if err != nil {
		t.Fatalf("create: %v", err)
	}

	rootfs := filepath.Join(dir, "rootfs")
	passwd, err := os.ReadFile(filepath.Join(rootfs, "etc", "passwd"))
	if err != nil {
		t.Fatalf("no passwd in the container the shim made: %v", err)
	}
	if !strings.Contains(string(passwd), "acornfall:x:999:991:acornfall:/srv/acornfall/workspaces/app:/bin/sh") {
		t.Errorf("the container has no entry for the uid its tools run as:\n%s", passwd)
	}
	roots, err := os.ReadFile(filepath.Join(rootfs, caBundleInContainer))
	if err != nil {
		t.Fatalf("no bundle in the container the shim made: %v", err)
	}
	if string(roots) != "roots\n" {
		t.Errorf("the container's bundle is not the machine's: %q", roots)
	}
}
