package shim

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// NetworkPayload is the network a container is created with: the bridge it joins and the way
// out of the machine. The engine chooses the values (its own constants); the shim, which is the
// side that lives in the machine, makes the bridge real.
type NetworkPayload struct {
	// Bridge is the bridge inside the machine, Subnet the network on it (10.7.0.0/24), and
	// Gateway the bridge's own address on it.
	Bridge  string `json:"bridge"`
	Subnet  string `json:"subnet"`
	Gateway string `json:"gateway"`
}

// ensureBridge makes the machine's bridge for containers that want a network, and the machine's
// way out of itself. Every step is idempotent — the bridge is made once and every container
// after the first finds it there — and every step is measured to be needed: a bridge with no
// address is a container that cannot reach it, forwarding off is a container that cannot leave
// it, and no masquerade is a container whose packets leave with a private source address.
func ensureBridge(runner Runner, network *NetworkPayload) error {
	if network.Bridge == "" || network.Subnet == "" || network.Gateway == "" {
		return errors.New("shim: a container's network needs a bridge, a subnet and a gateway")
	}
	prefix, _, found := strings.Cut(network.Subnet, "/")
	if !found || prefix == "" {
		return fmt.Errorf("shim: %q is not a network with a prefix", network.Subnet)
	}
	_, bits, found := strings.Cut(network.Subnet, "/")
	if !found || bits == "" {
		return fmt.Errorf("shim: %q is not a network with a prefix", network.Subnet)
	}
	run := func(args ...string) (string, error) {
		return runner.Run(context.Background(), args...)
	}
	// AlreadyThere is the ordinary case after the first container, and the runtime says so in
	// words rather than in an exit code the caller can tell apart: "File exists" for a link, and
	// — measured on a second workspace in the same machine — "Error: ipv4: Address already
	// assigned." for an address.
	alreadyThere := func(out string) bool {
		return strings.Contains(out, "exists") || strings.Contains(out, "already assigned")
	}

	if out, err := run("ip", "link", "add", network.Bridge, "type", "bridge"); err != nil && !alreadyThere(out) {
		return fmt.Errorf("shim: making the containers' bridge %s: %w", network.Bridge, err)
	}
	// replace, not add: the bridge is made once for the machine and every container after the
	// first finds its address there. `add` says so with an error, and reading that error as one
	// is a workspace with no sandbox whose refusal names an address that was already right.
	if out, err := run("ip", "addr", "replace", network.Gateway+"/"+bits, "dev", network.Bridge); err != nil && !alreadyThere(out) {
		return fmt.Errorf("shim: giving the containers' bridge its address: %w", err)
	}
	if _, err := run("ip", "link", "set", network.Bridge, "up"); err != nil {
		return fmt.Errorf("shim: bringing the containers' bridge up: %w", err)
	}
	// Forwarding is what lets a container's packet leave the machine at all. sysctl is not in a
	// slim image, so the file is the fallback rather than the other way round.
	if _, err := run("sysctl", "-q", "-w", "net.ipv4.ip_forward=1"); err != nil {
		if err := os.WriteFile("/proc/sys/net/ipv4/ip_forward", []byte("1\n"), 0o644); err != nil {
			return fmt.Errorf("shim: turning on forwarding so containers can leave the machine: %w", err)
		}
	}
	// The masquerade is the container's traffic wearing the machine's address on the way out.
	// Checked first, so a second container does not add a second rule.
	if _, err := run("iptables", "-t", "nat", "-C", "POSTROUTING", "-s", network.Subnet, "-j", "MASQUERADE"); err != nil {
		if _, err := run("iptables", "-t", "nat", "-A", "POSTROUTING", "-s", network.Subnet, "-j", "MASQUERADE"); err != nil {
			return fmt.Errorf("shim: giving the containers' network a way out: %w", err)
		}
	}
	return nil
}

// resolvFor gives the container the machine's own name resolution. A rootfs with no
// resolv.conf resolves nothing, and the machine is the thing that has a resolver: an image
// cannot carry the answer for the network it will be in.
func resolvFor(rootfs string) error {
	resolv, err := os.ReadFile("/etc/resolv.conf")
	if err != nil {
		// No resolver in the machine either: the container gets an empty file rather than a
		// dangling one, and the failure is visible where a person looks for it.
		resolv = nil
	}
	target := filepath.Join(rootfs, "etc", "resolv.conf")
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return err
	}
	return os.WriteFile(target, resolv, 0o644)
}
