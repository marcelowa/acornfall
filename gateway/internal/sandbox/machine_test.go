package sandbox

import (
	"context"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// machineRunner is the engine's own command line, recorded. It answers `list` with whatever the
// test says exists, which is how "created once" and "booted again" are told apart without a
// hypervisor.
type machineRunner struct {
	calls  [][]string
	listed []Instance
	help   string
}

func (r *machineRunner) Run(_ context.Context, args ...string) (string, error) {
	r.calls = append(r.calls, args)
	if len(args) > 0 && args[0] == "list" {
		if len(r.listed) == 0 {
			return "[]", nil
		}
		out, err := json.Marshal(r.listed)
		if err != nil {
			return "", err
		}
		return string(out), nil
	}
	if len(args) > 1 && args[0] == "create" && args[1] == "--help" {
		return r.help, nil
	}
	return "", nil
}

func (r *machineRunner) createArgs() []string {
	for _, call := range r.calls {
		if len(call) > 0 && call[0] == "create" && (len(call) < 2 || call[1] != "--help") {
			return call
		}
	}
	return nil
}

func (r *machineRunner) ran(command string) bool {
	for _, call := range r.calls {
		if len(call) > 0 && call[0] == command {
			return true
		}
	}
	return false
}

func machineDriver(t *testing.T, runner Runner) *Microsandbox {
	t.Helper()
	return machineDriverAt(t, shortTempDir(t), runner)
}

// machineDriverAt names the install, because the machine's name is derived from it: two tests
// that want to see the same machine have to have the same home.
func machineDriverAt(t *testing.T, home string, runner Runner) *Microsandbox {
	t.Helper()
	driver := NewMicrosandbox(home).WithRunner(runner)
	driver.installed = true
	return driver
}

// The machine is the install's one VM, so the first thing that matters is that asking twice does
// not make two: a second machine would be a second place workspaces live.
func TestTheMachineIsCreatedOnceAndBootedAgain(t *testing.T) {
	home := shortTempDir(t)
	runner := &machineRunner{}
	machine := NewMachineEngine(machineDriverAt(t, home, runner), Machine{}, t.TempDir())
	if err := machine.EnsureMachine(context.Background()); err != nil {
		t.Fatal(err)
	}
	created := runner.createArgs()
	if created == nil {
		t.Fatalf("a missing machine should be created: %v", runner.calls)
	}
	for _, want := range []string{"--name", machine.Name(), "--label", "acornfall"} {
		if !strings.Contains(strings.Join(created, " "), want) {
			t.Errorf("create should carry %q, got %v", want, created)
		}
	}

	// A running machine is left alone: nothing is created, nothing is started.
	alive := &machineRunner{listed: []Instance{{Name: MachineName(home), Status: "Running"}}}
	if err := NewMachineEngine(machineDriverAt(t, home, alive), Machine{}, t.TempDir()).EnsureMachine(context.Background()); err != nil {
		t.Fatal(err)
	}
	if alive.ran("create") || alive.ran("start") {
		t.Errorf("a running machine needs nothing, got %v", alive.calls)
	}

	// A stopped one is booted, never replaced: its containers' rootfs live on its disk.
	stopped := &machineRunner{listed: []Instance{{Name: MachineName(home), Status: "Stopped"}}}
	if err := NewMachineEngine(machineDriverAt(t, home, stopped), Machine{}, t.TempDir()).EnsureMachine(context.Background()); err != nil {
		t.Fatal(err)
	}
	if stopped.ran("create") {
		t.Errorf("a stopped machine is started, not recreated: %v", stopped.calls)
	}
	if !stopped.ran("start") {
		t.Errorf("a stopped machine should be started: %v", stopped.calls)
	}
}

// The machine is sized in its own policy file, which a person can read, and its disk is a create
// flag: the pinned engine's help has `--root-disk` there. Flat is the point — it keeps the
// containers inside from being an overlay on the VM's own overlay.
func TestTheMachineWritesItsPolicyAndItsDiskFlag(t *testing.T) {
	runner := &machineRunner{}
	dir := t.TempDir()
	machine := NewMachineEngine(machineDriver(t, runner), Machine{
		Image:  "acornfall-appliance:0.1",
		CPUs:   6,
		Memory: "12G",
		Disk:   "flat:40G",
		Share:  "/home/me/work",
	}, dir)
	if err := machine.EnsureMachine(context.Background()); err != nil {
		t.Fatal(err)
	}
	policy, err := os.ReadFile(filepath.Join(dir, "machine", "sandbox.yaml"))
	if err != nil {
		t.Fatal(err)
	}
	for _, want := range []string{
		"image: acornfall-appliance:0.1",
		"cpus: 6",
		"memory: 12G",
		"- /home/me/work:/home/me/work",
	} {
		if !strings.Contains(string(policy), want) {
			t.Errorf("the machine's policy should hold %q, got:\n%s", want, policy)
		}
	}
	// The machine never stops: its policy names no idle timeout at all, which is the only thing
	// the engine reads as "no idle stop" (measured: `0s` stops a sandbox at once).
	if strings.Contains(string(policy), "idle_timeout") {
		t.Errorf("the machine must not be stopped for being idle, got:\n%s", policy)
	}
	if args := strings.Join(runner.createArgs(), " "); !strings.Contains(args, "--root-disk flat:40G") {
		t.Errorf("create should carry the disk, got %q", args)
	}
}

// The containers inside want a /dev/kvm of their own, so the machine is the one that asks for
// nesting — wherever the engine offers the switch and the machine can grant it. On the pin there
// is no switch, and guests nest whenever the host can (ADR 0018).
func TestTheMachineAsksForNestingForItsContainers(t *testing.T) {
	runner := &machineRunner{help: "Usage: msb create [OPTIONS]\n      --nested-virt\n"}
	driver := machineDriver(t, runner)
	driver.hostNested = func() NestingSupport { return NestingSupport{Available: true} }
	if err := NewMachineEngine(driver, Machine{}, t.TempDir()).EnsureMachine(context.Background()); err != nil {
		t.Fatal(err)
	}
	if args := strings.Join(runner.createArgs(), " "); !strings.Contains(args, "--nested-virt") {
		t.Errorf("the machine should ask for nesting where it can get it, got %q", args)
	}
}

// Nobody has chosen the share root yet (ADR 0021 leaves it open). A machine without one mounts
// nothing — and names no mounts key at all, because an empty path is not a mount.
func TestAMachineWithNoShareNamesNoMount(t *testing.T) {
	policy := Machine{}.Policy().Render()
	if strings.Contains(string(policy), "mounts:") {
		t.Errorf("a machine with no share root should mount nothing, got:\n%s", policy)
	}
	if !strings.Contains(string(policy), "image: "+DefaultMachineImage) {
		t.Errorf("the rest of the policy is still written, got:\n%s", policy)
	}
}

// The manager installs the engine before it asks for a machine, so the machine refuses when it
// is not there: a policy file written for an engine that cannot be run is a file nobody reads.
func TestTheMachineRefusesBeforeTheEngineIsInstalled(t *testing.T) {
	runner := &machineRunner{}
	dir := t.TempDir()
	driver := NewMicrosandbox(shortTempDir(t)).WithRunner(runner)
	if err := NewMachineEngine(driver, Machine{}, dir).EnsureMachine(context.Background()); err == nil {
		t.Fatal("want a refusal naming the engine")
	} else if !strings.Contains(err.Error(), "not installed") {
		t.Fatalf("the refusal should name the engine, got %v", err)
	}
	if len(runner.calls) != 0 {
		t.Errorf("nothing should be asked of an engine that is not installed: %v", runner.calls)
	}
	if _, err := os.Stat(filepath.Join(dir, "machine")); err == nil {
		t.Error("no policy file should be written either")
	}
}

func TestMachineNameIsStableAndApartFromWorkspaces(t *testing.T) {
	first := MachineName("/home/me/.acornfall")
	if first != MachineName("/home/me/.acornfall") {
		t.Error("the machine's name has to be the same on every start")
	}
	if first == MachineName("/home/me/.acornfall-other") {
		t.Error("two installs must not share a machine")
	}
	if first == Name("/home/me/.acornfall") {
		t.Error("the machine's name must not collide with a workspace's")
	}
	if !strings.HasPrefix(first, "acornfall-machine-") {
		t.Errorf("name = %q, want it readable", first)
	}
}

// The door is part of the machine's own configuration: the engine publishes a host socket on a
// vsock port inside it, and that port is the only way in. A machine made without it is a machine
// nothing outside can speak to, which is how this was found (the shim dialed into nothing and
// the machine sat there).
func TestTheMachineCarriesItsDoor(t *testing.T) {
	runner := &machineRunner{}
	machine := NewMachineEngine(machineDriver(t, runner), Machine{}, t.TempDir()).
		WithDoor("/home/me/.acornfall/state/machine.sock", DefaultDoorPort)
	if err := machine.EnsureMachine(context.Background()); err != nil {
		t.Fatal(err)
	}
	if args := strings.Join(runner.createArgs(), " "); !strings.Contains(args, "--vsock /home/me/.acornfall/state/machine.sock:7411") {
		t.Errorf("the machine should carry its door, got %q", args)
	}

	plain := &machineRunner{}
	if err := NewMachineEngine(machineDriver(t, plain), Machine{}, t.TempDir()).EnsureMachine(context.Background()); err != nil {
		t.Fatal(err)
	}
	if args := strings.Join(plain.createArgs(), " "); strings.Contains(args, "--vsock") {
		t.Errorf("a machine with no door should not be given one, got %q", args)
	}
}

// The appliance is part of the machine's own configuration: what it runs as its init, and the
// port the console reaches it on. Both are create-time flags, which is why an install that
// changes them recreates the machine rather than expecting a running one to change its mind.
func TestTheMachineCanBootAsTheAppliance(t *testing.T) {
	runner := &machineRunner{}
	machine := NewMachineEngine(machineDriver(t, runner), Machine{}, t.TempDir()).
		WithAppliance("exec /usr/local/bin/acornfall gateway --addr 127.0.0.1:7777", "127.0.0.1:7777:7777")
	if err := machine.EnsureMachine(context.Background()); err != nil {
		t.Fatal(err)
	}
	args := strings.Join(runner.createArgs(), " ")
	if !strings.Contains(args, "--init /bin/sh --init-arg -c") {
		t.Errorf("the machine runs the appliance as its init, got %q", args)
	}
	if !strings.Contains(args, "--init-arg exec /usr/local/bin/acornfall gateway --addr 127.0.0.1:7777") {
		t.Errorf("the appliance runs as one argument, got %q", args)
	}
	if !strings.Contains(args, "--port 127.0.0.1:7777:7777") {
		t.Errorf("the console needs a port, got %q", args)
	}

	plain := &machineRunner{}
	if err := NewMachineEngine(machineDriver(t, plain), Machine{}, t.TempDir()).EnsureMachine(context.Background()); err != nil {
		t.Fatal(err)
	}
	if args := strings.Join(plain.createArgs(), " "); strings.Contains(args, "--entrypoint") || strings.Contains(args, "--port") {
		t.Errorf("a container host boots its image's own init, got %q", args)
	}
}
