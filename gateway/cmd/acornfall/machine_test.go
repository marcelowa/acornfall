package main

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
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
