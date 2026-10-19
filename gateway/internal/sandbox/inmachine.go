package sandbox

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/acornfall/acornfall/gateway/internal/shim"
	"github.com/acornfall/acornfall/gateway/internal/update"
)

// InMachine is the container engine of a gateway that runs inside the machine itself. ADR 0022
// puts the product in the machine, so a workspace's containers are this process's own
// neighbours: there is no door to open, no vsock to bridge, nothing to copy in, and no machine
// to create — this process is in it.
//
// The container work is the shim's, unchanged and in this process. The server that answers over
// a wire when the gateway is on the host answers over an in-memory pipe here: one
// implementation of "make, start, stop and exec in a container" is what keeps the two paths
// from drifting apart, and the pipe is the honest shape of it — the shim is here, next to the
// gateway, and nothing has to be sent anywhere.
type InMachine struct {
	// root is the folder the machine mounted. A workspace has to live under it for its container
	// to be able to bind it: the container's view of the product is the machine's view, which is
	// the mount (ADR 0022).
	root string
	// dir is where containers are made, and privileged runs every one of them as root in this
	// machine — the host-side engine's sharpest trade (ADR 0021), kept here so one profile is
	// not quietly different from the other.
	dir        string
	privileged bool
	log        func(string, ...any)
	// runner runs the container runtime's command line. In the machine that is the machine's own
	// PATH; injected so this engine is tested without a container runtime.
	runner shim.Runner

	mu      sync.Mutex
	client  *shim.Client
	runtime string
}

// NewInMachine builds the engine of a gateway that is inside the machine. root is the folder
// the machine mounted.
func NewInMachine(root string) *InMachine {
	return &InMachine{root: root, dir: "/var/lib/lxc", runner: shim.ExecRunner{}}
}

// WithRunner replaces the runtime's command line. Tests use it; nothing else does.
func (x *InMachine) WithRunner(runner shim.Runner) *InMachine {
	x.runner = runner
	return x
}

// WithPrivileged runs the containers as root in this machine.
func (x *InMachine) WithPrivileged(privileged bool) *InMachine {
	x.privileged = privileged
	return x
}

// WithContainerDir is where containers live in this machine.
func (x *InMachine) WithContainerDir(dir string) *InMachine {
	x.dir = dir
	return x
}

// WithLog reports what the engine does.
func (x *InMachine) WithLog(log func(string, ...any)) *InMachine {
	x.log = log
	return x
}

// Name is the engine's family name, and it is "lxc" on purpose: the worker matches this name
// with its own client, and what runs the tools here is lxc, in this machine.
func (x *InMachine) Name() string { return "lxc" }

// Isolated is yes: the containers are the machine's own, and the machine is not the host.
func (x *InMachine) Isolated() bool { return true }

// InstallDir is where the runtime lives. Nothing was installed by us: it is the image's lxc.
func (x *InMachine) InstallDir() string { return "/usr/bin" }

// StateDir is where the containers live: this machine's own runtime folder.
func (x *InMachine) StateDir() string { return x.dir }

// Env is what a process needs to find this engine's sandboxes: nothing. They are this machine's
// own containers, and the runtime finds them where it always does.
func (x *InMachine) Env() []string { return nil }

// Installed reports whether this machine has a container runtime, which is the only thing that
// has to be true here: the appliance image is where it comes from.
func (x *InMachine) Installed() bool { return x.Version() != "" }

// Version is the runtime's own version — the image's, not ours — asked once and kept.
func (x *InMachine) Version() string {
	x.mu.Lock()
	if x.runtime != "" {
		version := x.runtime
		x.mu.Unlock()
		return version
	}
	x.mu.Unlock()
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	out, err := x.runner.Run(ctx, shim.HelloRuntimeCommand()...)
	if err != nil {
		return ""
	}
	version := strings.TrimSpace(strings.SplitN(out, "\n", 2)[0])
	x.mu.Lock()
	x.runtime = version
	x.mu.Unlock()
	return version
}

// Install has nothing to fetch: the appliance image carries the container runtime and the tools
// a container needs (ADR 0022 — one image, and it is the product). It says so rather than
// pretending to download something, and it refuses when the image is wrong.
func (x *InMachine) Install(_ context.Context, log func(string, ...any)) error {
	if !x.Installed() {
		return fmt.Errorf("%w: this machine has no container runtime: its image needs one (lxc), which is what the appliance image is for", ErrUnavailable)
	}
	if log != nil {
		log("sandbox: the machine's image carries the container runtime (%s); nothing to install", x.Version())
	}
	return nil
}

// Usable reports whether containers can be made here. The runtime being present is the whole
// answer inside the machine: the containers are unprivileged by default, and the id ranges that
// needs are the image's business (scripts/build-appliance.sh writes them).
func (x *InMachine) Usable() error {
	if !x.Installed() {
		return fmt.Errorf("%w: this machine has no container runtime: its image needs one (lxc), which is what the appliance image is for", ErrUnavailable)
	}
	return nil
}

// Nesting reports whether a container here could nest virtual machines. It is the machine's own
// answer, because the containers are in it: the same two halves the host-side engine asks
// (docs/adr/0018-disable-vm-nesting.md), with the engine half already settled — the runtime is
// lxc, which nests when the device is there.
func (x *InMachine) Nesting(context.Context) NestingSupport { return hostNestedSupport() }

// EnsureMachine is nothing here, and that is the whole point of this engine: the machine the
// containers live in is the one this process runs in. There is nothing to create, boot or keep
// alive.
func (x *InMachine) EnsureMachine(context.Context) error { return nil }

// List is every container this machine has.
func (x *InMachine) List(ctx context.Context) ([]Instance, error) {
	client, err := x.containers(ctx)
	if err != nil {
		return nil, err
	}
	containers, err := client.List(ctx)
	if err != nil {
		return nil, err
	}
	instances := make([]Instance, 0, len(containers))
	for _, container := range containers {
		instances = append(instances, Instance{Name: container.Name, Status: container.Status})
	}
	return instances, nil
}

// Create makes one workspace's container: the rootfs from the workspace's image, the
// configuration the policy maps to, and the mounts the policy names — and nothing else.
func (x *InMachine) Create(ctx context.Context, policy Policy, policyDir string) error {
	container, settings, err := x.container(policy)
	if err != nil {
		return err
	}
	config, err := container.LXCConfig(settings)
	if err != nil {
		return err
	}
	if strings.TrimSpace(policyDir) == "" {
		return errors.New("sandbox: no directory for the container's configuration")
	}
	if err := os.MkdirAll(policyDir, 0o755); err != nil {
		return err
	}
	// A person reads what the workspace's container is allowed to be, the way a microVM
	// sandbox's policy file is readable.
	if err := os.WriteFile(filepath.Join(policyDir, "container.conf"), config, 0o644); err != nil {
		return err
	}
	client, err := x.containers(ctx)
	if err != nil {
		return err
	}
	payload := shim.CreatePayload{
		Name:    container.Name,
		Network: networkPayload(settings.Network),
		// The image that becomes the rootfs is the container's, which went through the
		// policy's defaults: a workspace that never named one has an empty policy image.
		Image:       container.Image,
		Dir:         settings.Dir,
		Config:      string(config),
		Owner:       settings.UID,
		Group:       settings.GID,
		RootfsOwner: settings.RootfsOwner(),
		RootfsGroup: settings.RootfsGroup(),
	}
	for _, bind := range container.Binds {
		payload.Binds = append(payload.Binds, shim.Bind{Source: bind.Source, Target: bind.Target, File: bind.File})
	}
	return client.Create(ctx, payload)
}

// Start boots a workspace's container.
func (x *InMachine) Start(ctx context.Context, name string) error {
	client, err := x.containers(ctx)
	if err != nil {
		return err
	}
	return client.Start(ctx, name)
}

// Stop shuts one down, the container's own way (lxc-stop): the workspace keeps its files.
func (x *InMachine) Stop(ctx context.Context, name string) error {
	client, err := x.containers(ctx)
	if err != nil {
		return err
	}
	return client.Stop(ctx, name)
}

// Remove takes one away for good.
func (x *InMachine) Remove(ctx context.Context, name string) error {
	client, err := x.containers(ctx)
	if err != nil {
		return err
	}
	return client.Remove(ctx, name)
}

// containers is the shim, in this process: one pipe, made once, with the same server on the
// other end of it that a machine dials into when the gateway is on the host.
func (x *InMachine) containers(ctx context.Context) (*shim.Client, error) {
	x.mu.Lock()
	if x.client != nil {
		select {
		case <-x.client.Closed():
			x.client = nil
		default:
			client := x.client
			x.mu.Unlock()
			return client, nil
		}
	}
	server, client := net.Pipe()
	shimServer := &shim.Server{Version: update.BuildVersion, Runner: x.runner, Log: x.log}
	go func() {
		if err := shimServer.Serve(server); err != nil && x.log != nil {
			x.log("the container shim ended: %v", err)
		}
	}()
	live := shim.NewClient(client)
	x.client = live
	x.mu.Unlock()

	// The handshake is also the question "is there a runtime here": it is what the gateway on
	// the host asks a machine through the door, asked of ourselves.
	hello, err := live.Hello(ctx)
	if err != nil {
		x.forget(live)
		return nil, err
	}
	if hello.Runtime == "" {
		x.forget(live)
		return nil, fmt.Errorf("%w: this machine has no container runtime: its image needs one (lxc), which is what the appliance image is for", ErrUnavailable)
	}
	x.mu.Lock()
	x.runtime = hello.Runtime
	x.mu.Unlock()
	return live, nil
}

// forget drops a connection that did not become a client, so the next call makes a fresh pipe
// instead of talking into a dead one.
func (x *InMachine) forget(client *shim.Client) {
	client.Close()
	x.mu.Lock()
	if x.client == client {
		x.client = nil
	}
	x.mu.Unlock()
}

// container maps a workspace's policy onto a container and its settings. The mapping itself is
// shared with the host-side engine (ContainerFor), so a workspace's container cannot differ by
// which of the two is running. The share root is this machine's mount, because that is the
// folder the containers can see (ADR 0022).
func (x *InMachine) container(policy Policy) (Container, LXCSettings, error) {
	return ContainerFor(policy, x.root, x.dir, x.privileged, hostNestedSupport().Available)
}
