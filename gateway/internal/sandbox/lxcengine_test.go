package sandbox

import (
	"context"
	"errors"
	"fmt"
	"io"
	"maps"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/acornfall/acornfall/gateway/internal/shim"
)

// fakeLXC is the container runtime's command line inside a machine, recorded: the engine's
// calls are real protocol calls through a real shim server, and what they come to is what this
// records.
type fakeLXC struct {
	mu      sync.Mutex
	calls   [][]string
	answers map[string]string
}

func (f *fakeLXC) Run(_ context.Context, args ...string) (string, error) {
	f.mu.Lock()
	f.calls = append(f.calls, args)
	f.mu.Unlock()
	key := strings.Join(args, " ")
	for prefix, answer := range f.answers {
		if strings.HasPrefix(key, prefix) {
			return answer, nil
		}
	}
	return "", nil
}

func (f *fakeLXC) Start(context.Context, ...string) (shim.Handle, error) {
	return nil, errors.New("the engine does not run commands: the worker does")
}

func (f *fakeLXC) ran(prefix string) []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, call := range f.calls {
		if strings.HasPrefix(strings.Join(call, " "), prefix) {
			return call
		}
	}
	return nil
}

// newFakeLXC is the runtime of a machine that has one: every test but the one about a machine
// without it starts here.
func newFakeLXC(answers map[string]string) *fakeLXC {
	all := map[string]string{"lxc-start --version": "6.0.4"}
	maps.Copy(all, answers)
	return &fakeLXC{answers: all}
}

// fakeDoor is the shim door as a test's: every call to it gets a fresh connection to a real shim
// server whose runtime is fake.
func fakeDoor(t *testing.T, runtime *fakeLXC) func(ctx context.Context) (net.Conn, error) {
	t.Helper()
	server := &shim.Server{Version: "test", Runner: runtime, Log: t.Logf}
	return func(ctx context.Context) (net.Conn, error) {
		client, machine := net.Pipe()
		go func() { _ = server.Serve(machine) }()
		return client, nil
	}
}

// lxcEngine builds the engine with a machine that answers through a fake runner, a door that
// reaches a fake shim, and a share root the test chose.
func lxcEngine(t *testing.T, runtime *fakeLXC, share string) *LXC {
	t.Helper()
	home := shortTempDir(t)
	engine := NewMicrosandbox(home).WithRunner(&machineRunner{})
	engine.installed = true
	door := filepath.Join(t.TempDir(), "machine.sock")
	return NewLXC(engine, Machine{ShareRoot: share}, door, "/bin/true").
		WithShimConnection(fakeDoor(t, runtime)).
		WithContainerDir(t.TempDir())
}

func TestTheEngineListsOnlyContainers(t *testing.T) {
	runtime := newFakeLXC(map[string]string{
		"lxc-ls -1":                             "acornfall-app-1234abcd",
		"lxc-info -n acornfall-app-1234abcd -s": "State: RUNNING",
	})
	engine := lxcEngine(t, runtime, t.TempDir())
	instances, err := engine.List(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if len(instances) != 1 || instances[0].Name != "acornfall-app-1234abcd" || !instances[0].Running() {
		t.Fatalf("instances = %+v: the machine is not a workspace", instances)
	}
}

// The whole engine in one test: a policy becomes a container, and every step of it is the one
// the spike measured as required.
func TestAContainerIsMadeFromThePolicysImage(t *testing.T) {
	runtime := newFakeLXC(nil)
	share := t.TempDir()
	workspace := filepath.Join(share, "work")
	if err := os.MkdirAll(workspace, 0o755); err != nil {
		t.Fatal(err)
	}
	engine := lxcEngine(t, runtime, share)
	policyDir := t.TempDir()
	if err := // Privileged on purpose: the container work is the subject here, and an unprivileged container
		// asks the shim to write /etc/subuid, which a CI user may not do.
		engine.Create(context.Background(), Policy{Workspace: workspace, Image: "golang:1.24", CPUs: 2, Memory: "1G", Privileged: true}, policyDir); err != nil {
		t.Fatal(err)
	}
	create := runtime.ran("lxc-create")
	if create == nil || !strings.Contains(strings.Join(create, " "), "docker://golang:1.24") {
		t.Fatalf("the workspace's image becomes the rootfs, got %v", runtime.calls)
	}
	config, err := os.ReadFile(filepath.Join(policyDir, "container.conf"))
	if err != nil {
		t.Fatal(err)
	}
	text := string(config)
	for _, want := range []string{
		"lxc.uts.name = " + Name(workspace),
		"lxc.rootfs.path = dir:" + filepath.Join(engine.dir, Name(workspace), "rootfs"),
		"lxc.mount.auto = proc:mixed",
		"lxc.cgroup2.cpu.max = 200000 100000",
		"lxc.mount.entry = " + workspace + " " + strings.TrimPrefix(workspace, "/") + " none bind,create=dir,optional",
	} {
		if !strings.Contains(text, want) {
			t.Errorf("the container's configuration should hold %q, got:\n%s", want, text)
		}
	}
}

// The machine has to be there before a container is: the engine ensures it, and the door is open
// before the machine is created, which is the order the door's direction was measured in.
func TestTheDoorIsOpenBeforeTheMachineIsMade(t *testing.T) {
	runtime := newFakeLXC(nil)
	engine := lxcEngine(t, runtime, t.TempDir())
	machine := &machineRunner{}
	engine.engine.WithRunner(machine)
	if err := engine.EnsureMachine(context.Background()); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(engine.door); err != nil {
		t.Errorf("the shim door should be listening: %v", err)
	}
	if machine.createArgs() == nil {
		t.Errorf("the machine should have been created: %v", machine.calls)
	}
}

// Nobody has chosen the share root yet (ADR 0021 leaves it open). A container cannot be bound
// from a folder nobody named, so the engine refuses rather than guessing one.
func TestAShareRootNobodyChoseIsRefused(t *testing.T) {
	runtime := newFakeLXC(nil)
	engine := lxcEngine(t, runtime, "")
	err := engine.Create(context.Background(), Policy{Workspace: "/home/me/work"}, t.TempDir())
	if err == nil || !strings.Contains(err.Error(), "share root") {
		t.Fatalf("want a refusal naming the share root, got %v", err)
	}
	if runtime.ran("lxc-create") != nil {
		t.Error("nothing should be made when the policy cannot be bound")
	}
}

// A machine whose image has no container runtime is a machine that cannot run a workspace: the
// handshake says so, and the engine refuses with that sentence rather than failing three calls
// later.
func TestTheEngineRefusesAMachineWithNoRuntime(t *testing.T) {
	// A runtime that answers nothing to `lxc-start --version` is a machine without one.
	runtime := &fakeLXC{}
	engine := lxcEngine(t, runtime, t.TempDir())
	// The fake runtime answers nothing to `lxc-start --version`, which is a machine without one.
	_, err := engine.List(context.Background())
	if err == nil || !errors.Is(err, ErrUnavailable) || !strings.Contains(err.Error(), "container runtime") {
		t.Fatalf("want a refusal naming the runtime, got %v", err)
	}
}

// The privileged profile is the ADR's sharpest trade, so it is a switch a person sets, and the
// configuration it writes is the one the spike measured for it.
func TestPrivilegedRunsTheOtherProfile(t *testing.T) {
	runtime := newFakeLXC(nil)
	share := t.TempDir()
	workspace := filepath.Join(share, "work")
	if err := os.MkdirAll(workspace, 0o755); err != nil {
		t.Fatal(err)
	}
	engine := lxcEngine(t, runtime, share).WithPrivileged(true)
	policyDir := t.TempDir()
	if err := engine.Create(context.Background(), Policy{Workspace: workspace, Image: "debian:stable-slim"}, policyDir); err != nil {
		t.Fatal(err)
	}
	config, err := os.ReadFile(filepath.Join(policyDir, "container.conf"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(config), "lxc.mount.auto = proc:mixed sys:mixed") {
		t.Errorf("a privileged container mounts sysfs, got:\n%s", config)
	}
	if strings.Contains(string(config), "lxc.idmap") {
		t.Errorf("a privileged container needs no map, got:\n%s", config)
	}
}

func TestTheEnginesOwnNameIsWhatTheWorkerIsTold(t *testing.T) {
	engine := lxcEngine(t, newFakeLXC(nil), t.TempDir())
	if engine.Name() != "lxc" {
		t.Errorf("name = %q: the worker matches it", engine.Name())
	}
	if !engine.Isolated() {
		t.Error("a container in a machine separates a workspace from the host")
	}
	if engine.StateDir() == "" || engine.InstallDir() == "" {
		t.Error("the engine's own store is where the per-workspace one is")
	}
	var _ Driver = engine
	var _ MachineLayer = engine
}

// The engine's door is a socket only this install uses: what connects to it comes through the
// machine's own bridge.
func TestTheDoorsSocketIsTheInstallsOwn(t *testing.T) {
	engine := lxcEngine(t, newFakeLXC(nil), t.TempDir())
	if err := engine.listen(); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(engine.door)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Errorf("the door's mode is %o, want 0600", info.Mode().Perm())
	}
	if err := engine.listen(); err != nil {
		t.Errorf("listening twice is not a mistake: %v", err)
	}
	_ = fmt.Sprint(io.Discard)
}

// The door's queue, on its own: a connection that arrives while nobody is waiting has to be
// handed to the next wait. The live run found the alternative — the accept loop logged the shim
// connecting and the wait still timed out — and this is the smallest test that says which.
func TestAConnectionThatArrivesWhileNobodyWaitsIsNotLost(t *testing.T) {
	home := shortTempDir(t)
	engine := NewMicrosandbox(home).WithRunner(&machineRunner{})
	engine.installed = true
	door := filepath.Join(t.TempDir(), "machine.sock")
	driver := NewLXC(engine, Machine{}, door, "/bin/true")
	if err := driver.listen(); err != nil {
		t.Fatal(err)
	}
	// It arrives before anybody waits.
	shimSide, err := net.Dial("unix", door)
	if err != nil {
		t.Fatal(err)
	}
	defer shimSide.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	conn, err := driver.accept(ctx, 2*time.Second)
	if err != nil {
		t.Fatalf("a queued connection should be handed over: %v", err)
	}
	conn.Close()
}

// Listing is a read: an install that has never made a machine answers "no containers" and creates
// nothing. Measured with doctor, which asks this question about every install — and the lxc
// engine answered by trying to copy the shim into a machine that did not exist, reporting the
// copy's failure as the sandbox's problem.
func TestListingCreatesNothing(t *testing.T) {
	home := shortTempDir(t)
	engine := NewMicrosandbox(home).WithRunner(&machineRunner{})
	engine.installed = true
	machine := &machineRunner{}
	engine.WithRunner(machine)
	door := filepath.Join(t.TempDir(), "machine.sock")
	driver := NewLXC(engine, Machine{ShareRoot: t.TempDir()}, door, "/bin/true")
	ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
	defer cancel()
	instances, err := driver.List(ctx)
	if err != nil {
		t.Fatalf("a read that finds nothing is not a failure: %v", err)
	}
	if len(instances) != 0 {
		t.Errorf("instances = %v, want none", instances)
	}
	if machine.createArgs() != nil {
		t.Errorf("listing must not create a machine: %v", machine.calls)
	}
	if machine.ran("copy") {
		t.Error("listing must not deliver the shim")
	}
}
