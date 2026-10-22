package shim

import (
	"context"
	"os"
	"os/exec"
	"strings"
	"testing"
)

// Live: the bridge a second container finds is the bridge the first one made, address and all.
//
// The bug this pins was measured on a real host: `ip addr add` cannot run twice, it answers "Error:
// ipv4: Address already assigned.", the shim read that as a failure, and every workspace but the
// first in a machine was a workspace with no sandbox.
//
//	ACORNFALL_NET=1 go test ./internal/shim -run LiveTheBridge
func TestLiveTheBridgeIsMadeOnceAndFoundAgain(t *testing.T) {
	if os.Getenv("ACORNFALL_NET") == "" {
		t.Skip("set ACORNFALL_NET=1 to make a real bridge on this machine")
	}
	// The appliance image carries iptables, where the bridge's way out is made; a development
	// machine without it can still be the place this test runs, but not past this point.
	if _, err := exec.LookPath("iptables"); err != nil {
		t.Skip("no iptables here: the bridge is made, the way out is the image's business")
	}
	network := &NetworkPayload{Bridge: "acornfall-live0", Subnet: "10.77.0.0/24", Gateway: "10.77.0.1"}
	runner := ExecRunner{}
	// A bridge of its own, so the test does not depend on, or disturb, the machine it runs in.
	t.Cleanup(func() { _, _ = runner.Run(context.Background(), "ip", "link", "del", network.Bridge) })
	_, _ = runner.Run(context.Background(), "ip", "link", "del", network.Bridge)
	for attempt := 1; attempt <= 2; attempt++ {
		if err := ensureBridge(runner, network); err != nil {
			t.Fatalf("the bridge, on attempt %d: %v", attempt, err)
		}
	}
	out, err := runner.Run(context.Background(), "ip", "-4", "addr", "show", "dev", network.Bridge)
	if err != nil {
		t.Fatal(err)
	}
	if count := strings.Count(out, network.Gateway+"/24"); count != 1 {
		t.Errorf("the bridge should carry its address once, found %d in:\n%s", count, out)
	}
}
