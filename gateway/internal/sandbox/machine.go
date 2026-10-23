package sandbox

import (
	"context"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// The machine half of the shape ADR 0021 proposes: one microVM per machine, created once,
// sized here, with every workspace's container inside it. It is a sandbox to the pinned engine
// like any other — same store, same command line — so nothing about the engine changes.

// Machine is what the install asks its one VM to be. It is not a workspace's policy: the
// numbers here are the ceiling the containers share, and the workspace policies are the
// smaller, per-workspace limits inside it. The defaults are provisional — the ADR says the
// disk is sized at install and cpu and memory by config, and neither the flags nor the
// installer ask for them yet — so they are named, unremarkable, and in one place.
type Machine struct {
	// Image is the VM's own image: the appliance the containers run inside. It is not a
	// workspace's image; each container brings its own (that is what a workspace's OCI image
	// becomes). Ours has to carry the container tooling, and that image is not built yet.
	Image string
	// CPUs and Memory cap the whole machine.
	CPUs   int
	Memory string
	// Disk is the VM's root disk. A flat disk is the point: it gives the containers inside a
	// direct ext4 instead of an overlay on the VM's OverlayFS (ADR 0021). Size it for every
	// workspace's rootfs together.
	Disk string
	// Share is the one host folder the VM mounts — the only door from the machine's
	// containers to the user's files. Empty means nobody has chosen it yet (the ADR leaves the
	// choice open), and a machine without one mounts nothing: its containers then have no door
	// at all, which is the safe direction for a guess.
	Share string
	// NoEgress takes the machine off the network. It is off by default because the machine needs
	// the network for its own work — pulling the image a workspace.s container is made of is the
	// first thing it does — and a workspace.s own reach is a different question entirely: a
	// container is made with no network of its own (lxc.go), so what the machine can reach is not
	// what a workspace can.
	NoEgress bool
	// IdleTimeout is when the engine stops the VM for being idle. The owner's call of
	// 2026-10-19: the machine never stops. It has to outlive every workspace's container, and a
	// stopped machine is every workspace at once; NoIdleStop is how the policy says so (measured
	// on the pin: an omitted idle_timeout is no idle stop at all). A workspace's own container
	// still stops after its own idle timeout — that is a container's business, not the VM's.
	IdleTimeout string
}

// The install's machine defaults, to be overridden by config when that exists.
const (
	DefaultMachineImage       = "debian:stable-slim"
	DefaultMachineCPUs        = 4
	DefaultMachineMemory      = "8G"
	DefaultMachineDisk        = "flat:20G"
	DefaultMachineIdleTimeout = NoIdleStop
)

func (m Machine) withDefaults() Machine {
	if strings.TrimSpace(m.Image) == "" {
		m.Image = DefaultMachineImage
	}
	if m.CPUs <= 0 {
		m.CPUs = DefaultMachineCPUs
	}
	if strings.TrimSpace(m.Memory) == "" {
		m.Memory = DefaultMachineMemory
	}
	if strings.TrimSpace(m.IdleTimeout) == "" {
		m.IdleTimeout = DefaultMachineIdleTimeout
	}
	return m
}

// Policy is the machine as the engine's own configuration: the one folder it mounts, its size,
// and its network. Its containers' policies are separate, smaller, and inside it.
func (m Machine) Policy() Policy {
	m = m.withDefaults()
	return Policy{
		Image:       m.Image,
		CPUs:        m.CPUs,
		Memory:      m.Memory,
		Egress:      !m.NoEgress,
		Workspace:   m.Share,
		IdleTimeout: m.IdleTimeout,
		// The machine's share is presented at a fixed owner, independent of the process that
		// started the machine. The container inside then sees a non-root workspace and can stay
		// unprivileged; the host user never reaches the container's id map.
		mountOwner: shareOwner(m.Share),
	}
}

// MachineName is the engine-level name of an install's machine. Derived from the installation
// folder so that two installs sharing an engine store still keep their own machines, and so
// that removing a workspace can never name it.
func MachineName(machinery string) string {
	return "acornfall-machine-" + shortHash(machinery)
}

// MachineEngine is the machine half of the engine ADR 0021 proposes. It is deliberately not a
// Driver: the container half arrives with the transport for LXC — who speaks to it, the
// gateway over the engine's exec or a shim in the guest, is the owner's open call — and an
// engine that cannot make a workspace must not be offered as one.
type MachineEngine struct {
	engine  *Microsandbox
	machine Machine
	// dir is where the machine's own policy file is written, so a person can read what the VM
	// is allowed to be.
	dir string
	// door is the host path the engine publishes to the machine, and doorPort the machine's vsock
	// port bridged to it: the way anything outside the machine reaches anything inside it. Empty
	// means no door, which is what a machine nobody speaks to looks like.
	door     string
	doorPort int
	// appliance is what the machine runs as its init when it is the whole product and not only the
	// container host (docs/adr/0022): the gateway, and the shim beside it. Empty means the machine
	// boots its image's own init, which is what a container host does.
	appliance string
	// forward is the port the console reaches the appliance on, in the engine's own spelling
	// ("HOST:GUEST" or "BIND:HOST:GUEST"). Empty means nothing is published.
	forward string
}

// NewMachineEngine wires the machine to the pinned engine. dir is a folder of the install's
// own (its state folder), not the engine's store.
func NewMachineEngine(engine *Microsandbox, machine Machine, dir string) *MachineEngine {
	return &MachineEngine{engine: engine, machine: machine.withDefaults(), dir: dir}
}

// Name is the machine's sandbox name, for callers that need to look it up or report it.
// WithDoor publishes a host socket to the machine over the engine's vsock bridge: what the
// gateway listens on and what the shim inside dials out to (docs/engineering/container-shim.md).
// It has to be set before the machine is created — the bridge is part of the machine's own
// configuration — and the listener has to be up first, or the machine dials into nothing.
func (x *MachineEngine) WithDoor(path string, port int) *MachineEngine {
	x.door = path
	x.doorPort = port
	return x
}

func (x *MachineEngine) Name() string { return MachineName(x.engine.machinery) }

// Machine is what this install asked the VM to be.
func (x *MachineEngine) Machine() Machine { return x.machine }

// EnsureMachine creates the VM when it is not there and boots it when it is stopped. It is
// idempotent, so every sandbox start may ask (MachineLayer). The engine has to be installed
// already: Manager installs it before it asks, and creating a machine for an engine that is
// not there would write a policy file nothing can read.
func (x *MachineEngine) EnsureMachine(ctx context.Context) error {
	if !x.engine.Installed() {
		return fmt.Errorf("%w: the sandbox engine is not installed", ErrUnavailable)
	}
	name := x.Name()
	instances, err := x.engine.List(ctx)
	if err != nil {
		return err
	}
	for _, instance := range instances {
		if instance.Name != name {
			continue
		}
		if instance.Running() {
			return nil
		}
		return x.engine.Start(ctx, name)
	}
	return x.create(ctx, name)
}

func (x *MachineEngine) create(ctx context.Context, name string) error {
	if strings.TrimSpace(x.dir) == "" {
		return errors.New("sandbox: nowhere to write the machine's policy file")
	}
	// The engine puts its runtime sockets under its store, and a Unix socket path has a hard
	// limit the engine's own layout eats most of: the same sentence the per-workspace path
	// gives, before the engine's own error arrives with the machine half-made.
	if len(x.engine.StateDir()) > statePathLimit {
		return fmt.Errorf(
			"%w: the machine's state folder is %d characters (%s) and the engine's sockets need %d or fewer, so acornfall cannot be installed this deep: use a shorter --machinery",
			ErrUnavailable, len(x.engine.StateDir()), x.engine.StateDir(), statePathLimit,
		)
	}
	path := filepath.Join(x.dir, "machine", "sandbox.yaml")
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	if err := os.WriteFile(path, x.machine.Policy().Render(), 0o644); err != nil {
		return err
	}
	args := []string{"create", "--conf", path, "--name", name, "--label", "acornfall"}
	// A flat root disk, so the containers inside are not an overlay on the VM's own overlay.
	if x.machine.Disk != "" {
		args = append(args, "--root-disk", x.machine.Disk)
	}
	// The door: the engine publishes this host socket on a vsock port inside the machine, and
	// that port is the only way in.
	if x.door != "" {
		args = append(args, "--vsock", fmt.Sprintf("%s:%d", x.door, x.doorPort))
	}
	// The appliance: what the machine runs as its init, and the port the console reaches it on.
	// The engine hands PID 1 to a binary of its own choosing (`--init`), so the init is a shell
	// that runs the appliance's own script and lets the last line of it — the gateway — take
	// PID 1 over with exec. `--script`/`--entrypoint` looks like the natural pair and is not:
	// that entrypoint only overrides an OCI image's, and a rootfs directory has none.
	if x.appliance != "" {
		args = append(args, "--init", "/bin/sh", "--init-arg", "-c", "--init-arg", x.appliance)
	}
	if x.forward != "" {
		args = append(args, "--port", x.forward)
	}
	// The machine asks for nesting wherever the machine can grant it, because the containers
	// inside are the ones that want a /dev/kvm; whether any workspace gets the device is its
	// own policy's business (docs/adr/0018-disable-vm-nesting.md), and the pinned engine has no
	// switch to offer (its guests nest whenever the host can).
	if engine := x.engine.engineNesting(ctx); engine.Available && x.engine.hostNesting().Available {
		args = append(args, "--nested-virt")
	}
	_, err := x.engine.run(ctx, args...)
	return err
}

// RemoveMachine deletes the machine and everything in it. Called when an install is removed,
// never when a workspace is: the machine outlives every workspace.
func (x *MachineEngine) RemoveMachine(ctx context.Context) error {
	if !x.engine.Installed() {
		return nil
	}
	return ignoreMissing(x.engine.Remove(ctx, x.Name()))
}

// WithAppliance boots the machine as the product's world: start is what the machine runs as its
// init — the gateway, with the shim beside it — and forward is the port the console reaches it on,
// in the engine's own spelling ("HOST:GUEST", or "BIND_ADDR:HOST:GUEST" to put it on the tailnet
// and nowhere else). Both are part of the machine's own configuration, so they are set before it
// is created, and a machine that already exists keeps what it booted with: an install that
// changes them recreates the machine, which is the honest price of an init that is fixed at boot.
func (x *MachineEngine) WithAppliance(start, forward string) *MachineEngine {
	x.appliance = start
	x.forward = forward
	return x
}
