package sandbox

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/acornfall/acornfall/gateway/internal/shim"
)

// fakeRuntime answers the container runtime's command line for a test: it records what was
// asked and answers what the test says. Start is only needed for exec, which the driver
// interface has no room for.
type fakeRuntime struct {
	answers map[string]string
	ran     []string
}

func (f *fakeRuntime) Run(_ context.Context, args ...string) (string, error) {
	line := strings.Join(args, " ")
	f.ran = append(f.ran, line)
	if answer, ok := f.answers[line]; ok {
		return answer, nil
	}
	for prefix, answer := range f.answers {
		if strings.HasPrefix(line, prefix) {
			return answer, nil
		}
	}
	return "", nil
}

func (f *fakeRuntime) Start(context.Context, ...string) (shim.Handle, error) {
	return nil, errors.New("this fake does not start commands")
}

func (f *fakeRuntime) did(prefix string) bool {
	for _, line := range f.ran {
		if strings.HasPrefix(line, prefix) {
			return true
		}
	}
	return false
}

// The engine of a gateway inside the machine: the containers are this machine's own, so the
// shim's work happens in this process, over a pipe, and there is no machine to make and no door
// to open. What is asserted here is that the container work still happens — the same protocol,
// the same commands — with nothing in between.
func TestTheEngineInTheMachineRunsItsOwnContainers(t *testing.T) {
	root := t.TempDir()
	workspace := filepath.Join(root, "workspaces", "general")
	if err := os.MkdirAll(workspace, 0o755); err != nil {
		t.Fatal(err)
	}
	runtime := &fakeRuntime{answers: map[string]string{
		"lxc-start --version": "6.0.4",
		"lxc-ls":              "one\n",
		"lxc-info":            "State: RUNNING",
	}}
	engine := NewInMachine(root).
		WithRunner(runtime).
		WithContainerDir(t.TempDir()).
		WithLog(t.Logf)

	if engine.Name() != "lxc" {
		t.Errorf("the worker matches this name with its own client, so it is lxc; got %q", engine.Name())
	}
	if !engine.Installed() {
		t.Error("the machine's own lxc is what the image carries, and this fake answers its version")
	}
	if engine.Version() != "6.0.4" {
		t.Errorf("version = %q, want the runtime's own", engine.Version())
	}
	if err := engine.Usable(); err != nil {
		t.Errorf("usable: %v", err)
	}
	if err := engine.EnsureMachine(context.Background()); err != nil {
		t.Errorf("there is no machine to ensure: this process is in it: %v", err)
	}
	if env := engine.Env(); len(env) != 0 {
		t.Errorf("the machine's containers need no environment to be found; got %v", env)
	}

	ctx := context.Background()
	instances, err := engine.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(instances) != 1 || instances[0].Name != "one" {
		t.Errorf("list = %+v, want what the runtime listed", instances)
	}

	policy := Policy{Image: "debian:stable-slim", Workspace: workspace}
	if err := engine.Create(ctx, policy, t.TempDir()); err != nil {
		t.Fatal(err)
	}
	if !runtime.did("lxc-create") {
		t.Error("creating a workspace's container is a container being created, not a record of one")
	}
	name := instances[0].Name
	if err := engine.Start(ctx, name); err != nil {
		t.Fatal(err)
	}
	if err := engine.Stop(ctx, name); err != nil {
		t.Fatal(err)
	}
	if err := engine.Remove(ctx, name); err != nil {
		t.Fatal(err)
	}
	if !runtime.did("lxc-start") || !runtime.did("lxc-stop") || !runtime.did("lxc-destroy") {
		t.Errorf("the container's own lifecycle should have run, got %v", runtime.ran)
	}
}

// A workspace outside the folder the machine mounted cannot be a container: the machine cannot
// see it, so its container could not bind it. The engine refuses rather than making one that
// cannot work.
func TestTheEngineInTheMachineRefusesAWorkspaceItCannotSee(t *testing.T) {
	root := t.TempDir()
	elsewhere := t.TempDir()
	engine := NewInMachine(root).WithRunner(&fakeRuntime{answers: map[string]string{"lxc-start --version": "6.0.4"}})
	err := engine.Create(context.Background(), Policy{Image: "debian:stable-slim", Workspace: elsewhere}, t.TempDir())
	if err == nil {
		t.Fatal("a workspace outside the machine's mount was accepted")
	}
	if !strings.Contains(err.Error(), "root") {
		t.Errorf("the refusal should name the share root, got %v", err)
	}
}

// No runtime in the image is a state a person has to be able to read: it is what the appliance's
// image is for, and the message says so.
func TestTheEngineInTheMachineSaysWhenTheImageHasNoRuntime(t *testing.T) {
	engine := NewInMachine(t.TempDir()).WithRunner(&fakeRuntime{answers: map[string]string{}})
	if engine.Installed() {
		t.Error("nothing answered the runtime's version, so nothing is installed")
	}
	if err := engine.Usable(); err == nil || !strings.Contains(err.Error(), "appliance image") {
		t.Errorf("usable = %v, want a refusal naming the appliance image", err)
	}
	if _, err := engine.List(context.Background()); err == nil {
		t.Error("listing containers without a runtime should refuse")
	}
}
