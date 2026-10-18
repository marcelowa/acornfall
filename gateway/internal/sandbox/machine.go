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
	// ShareRoot is the one host folder the VM mounts — the only door from the machine's
	// containers to the user's files. Empty means nobody has chosen it yet (the ADR leaves the
	// choice open), and a machine without one mounts nothing: its containers then have no door
	// at all, which is the safe direction for a guess.
	ShareRoot string
	// Egress is whether the VM itself may reach the network. A container's own network is a
	// separate question, and not built.
	Egress bool
	// IdleTimeout is when the engine stops the VM for being idle. It is deliberately long: the
	// machine outlives every workspace's container, so a workspace's own 30 minutes must not
	// stop the VM under the others. Whether it should stop with the last container is one of
	// the ADR's open questions.
	IdleTimeout string
}

// The install's machine defaults, to be overridden by config when that exists.
const (
	DefaultMachineImage       = "debian:stable-slim"
	DefaultMachineCPUs        = 4
	DefaultMachineMemory      = "8G"
	DefaultMachineDisk        = "flat:20G"
	DefaultMachineIdleTimeout = "24h"
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
		Egress:      m.Egress,
		Workspace:   m.ShareRoot,
		IdleTimeout: m.IdleTimeout,
	}
}

// MachineName is the engine-level name of an install's machine. Derived from the installation
// folder so that two installs sharing an engine store still keep their own machines, and so
// that removing a workspace can never name it.
func MachineName(home string) string {
	return "acornfall-machine-" + shortHash(home)
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
}

// NewMachineEngine wires the machine to the pinned engine. dir is a folder of the install's
// own (its state folder), not the engine's store.
func NewMachineEngine(engine *Microsandbox, machine Machine, dir string) *MachineEngine {
	return &MachineEngine{engine: engine, machine: machine.withDefaults(), dir: dir}
}

// Name is the machine's sandbox name, for callers that need to look it up or report it.
func (x *MachineEngine) Name() string { return MachineName(x.engine.home) }

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
