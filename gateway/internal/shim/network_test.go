package shim

import (
	"os"
	"strings"
	"testing"
)

// The bridge a container's network needs is made by the side that lives in the machine, and
// every step of it is a step the container cannot do without: an addressless bridge, forwarding
// that is off, or no masquerade each leave a container that starts and cannot reach anything.
func TestTheBridgeForContainersIsMadeWithWhatItNeeds(t *testing.T) {
	runtime := &fakeRuntime{}
	network := &NetworkPayload{Bridge: "acornfall0", Subnet: "10.7.0.0/24", Gateway: "10.7.0.1"}
	if err := ensureBridge(runtime, network); err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"ip link add acornfall0 type bridge",
		"ip addr add 10.7.0.1/24 dev acornfall0",
		"ip link set acornfall0 up",
		"sysctl -q -w net.ipv4.ip_forward=1",
		"iptables -t nat -C POSTROUTING -s 10.7.0.0/24 -j MASQUERADE",
	} {
		if len(runtime.ran(want)) == 0 {
			t.Errorf("want %q to have run, got %v", want, runtime.calls)
		}
	}
	// The check first and the rule only when it is missing: a second container must not add a
	// second masquerade.
	for _, call := range runtime.calls {
		if strings.Join(call, " ") == "iptables -t nat -A POSTROUTING -s 10.7.0.0/24 -j MASQUERADE" {
			t.Errorf("the rule was already there, so it should not have been added again: %v", runtime.calls)
		}
	}
}

// The second container of the same machine finds the bridge there, and "already there" is a
// success rather than a failure: the runtime says it in words.
func TestTheBridgeIsMadeOnceForTheMachine(t *testing.T) {
	runtime := &fakeRuntime{answers: map[string]string{
		"ip link add":        "RTNETLINK answers: File exists",
		"ip addr add":        "RTNETLINK answers: File exists",
		"iptables -t nat -C": "",
	}}
	network := &NetworkPayload{Bridge: "acornfall0", Subnet: "10.7.0.0/24", Gateway: "10.7.0.1"}
	if err := ensureBridge(runtime, network); err != nil {
		t.Fatalf("a bridge that is already there is not a failure: %v", err)
	}
}

// A network without its parts is refused rather than half-made.
func TestABridgeWithoutItsPartsIsRefused(t *testing.T) {
	if err := ensureBridge(&fakeRuntime{}, &NetworkPayload{Bridge: "acornfall0"}); err == nil {
		t.Error("a bridge with no subnet and no gateway should be refused")
	}
	if err := ensureBridge(&fakeRuntime{}, &NetworkPayload{Bridge: "acornfall0", Subnet: "10.7.0.0", Gateway: "10.7.0.1"}); err == nil {
		t.Error("a subnet with no prefix should be refused")
	}
}

// A container's resolver is the machine's: an image cannot carry the answer for the network it
// will be in, and a rootfs with no resolv.conf resolves nothing at all.
func TestAContainerGetsTheMachinesResolver(t *testing.T) {
	rootfs := t.TempDir()
	if err := resolvFor(rootfs); err != nil {
		t.Fatal(err)
	}
	written, err := readFile(rootfs + "/etc/resolv.conf")
	if err != nil {
		t.Fatal(err)
	}
	machine, err := readFile("/etc/resolv.conf")
	if err != nil {
		t.Fatal(err)
	}
	if string(written) != string(machine) {
		t.Errorf("the container's resolver should be the machine's:\n%q\n%q", written, machine)
	}
}

// readFile is os.ReadFile, named here so the test reads as what it is.
func readFile(path string) ([]byte, error) { return os.ReadFile(path) }
