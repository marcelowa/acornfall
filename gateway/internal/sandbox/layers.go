package sandbox

import (
	"context"
	"errors"
	"fmt"
	"github.com/acornfall/acornfall/gateway/internal/layout"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
)

// A sandbox is about to become two machines. Today one microVM is one workspace
// (docs/adr/0012-sandbox.md): one kernel, one boot, one memory footprint each. The sketch in
// docs/adr/0021-workspaces-as-lxc-containers.md lifts the VM up to the machine — created
// once, sized at install and by config — and puts every workspace in a container inside it,
// so a workspace costs a container and the platform seam is one piece.
//
// The split leaves Driver's names alone: Create, Start, Stop and Remove keep their meaning
// for a workspace, and act on the container. It is the machine that gets its own surface,
// because the machine outlives every sandbox and removing a workspace must never remove it.

// MachineLayer is the half of an engine that owns the machine's one VM. It sits beside Driver
// rather than inside it, because an engine whose sandbox *is* its VM — microsandbox today,
// the host engine always — has no machine to ensure, and a set of methods answering "there is
// none" would be a promise the engine does not keep.
type MachineLayer interface {
	// EnsureMachine creates the VM when it is not there and boots it when it is stopped. It is
	// idempotent: a running VM is left alone, so a sandbox may ask every time it starts.
	EnsureMachine(ctx context.Context) error
}

// Container is one workspace as the machine's container runtime sees it: the image as its
// rootfs, the policy's cpus and memory as cgroup limits, and its mounts as binds from the
// share root. It names no runtime on purpose — whether the gateway drives the runtime over
// the engine's exec or a shim in the guest does is still open, and neither answer changes
// this.
type Container struct {
	// Name is the engine's name for the workspace, the one an Instance reports.
	Name string
	// Image becomes the container's rootfs: the project's environment, not ours.
	Image string
	// CPUs and MemoryBytes are always explicit, even when the policy left them unset: the
	// container runtime's default is no limit, which would hand one workspace the whole
	// machine.
	CPUs        int
	MemoryBytes int64
	// Binds are every host path the container may see, and the only ones.
	Binds []Bind
	// Egress is whether the container gets a network at all.
	Egress bool
	// IdleTimeout is when the container stops itself. It stops the container and never the
	// machine: another workspace may be using it.
	IdleTimeout time.Duration
}

// Bind is one host path a container may see. Source is the path in the machine's VM, Target
// the path in the container; both are the same string, because a path in the model's world
// has to be the path in the user's world (docs/adr/0012-sandbox.md), and a container that
// moved it would break every instruction that names its own folder.
type Bind struct {
	Source   string
	Target   string
	ReadOnly bool
	// File is whether the path is a regular file rather than a folder, read from the host where
	// it exists. The runtime has to be told which kind of target to make, and the wrong kind is
	// a mount that silently does not happen: measured, `create=dir` leaves a file target
	// unmounted, and `create=auto` creates nothing at all.
	File bool
}

// Container maps a workspace's policy onto what a container runtime needs.
//
// shareRoot is the one host folder the machine's VM mounts. A policy path outside it cannot
// be bound: a bind past the share root would be a door nobody declared, and ADR 0021 accepts
// the share root only as small as the product can make it. An empty share root is a refusal
// rather than "bind nothing" — the install has not chosen the root yet, and a guess here
// would silently decide what an escape reaches.
func (p Policy) Container(shareRoot string) (Container, error) {
	p = p.withDefaults()
	if strings.TrimSpace(shareRoot) == "" {
		return Container{}, errors.New("sandbox: no share root: the machine's VM has nowhere to bind a container's folders from")
	}
	if strings.TrimSpace(p.Workspace) == "" {
		return Container{}, errors.New("sandbox: policy has no workspace")
	}
	root := filepath.Clean(shareRoot)
	// The workspace read-write at its own path, the globals read-only at theirs. Read-only is
	// the decision (docs/adr/0014-global-resources-in-the-sandbox.md), not a detail.
	binds := make([]Bind, 0, 1+len(p.Global))
	workspace, err := bindPath(root, p.Workspace, false)
	if err != nil {
		return Container{}, err
	}
	binds = append(binds, workspace)
	for _, path := range p.Global {
		global, err := bindPath(root, path, true)
		if err != nil {
			return Container{}, err
		}
		binds = append(binds, global)
	}
	memory, err := parseMemory(p.Memory)
	if err != nil {
		return Container{}, err
	}
	idle, err := time.ParseDuration(p.IdleTimeout)
	if err != nil {
		return Container{}, fmt.Errorf("sandbox: idle timeout %q is not a duration like 30m or 2h: %w", p.IdleTimeout, err)
	}
	return Container{
		Name:        Name(p.Workspace),
		Image:       p.Image,
		CPUs:        p.CPUs,
		MemoryBytes: memory,
		Binds:       binds,
		Egress:      p.Egress,
		IdleTimeout: idle,
	}, nil
}

// The share root's own shape, as ADR 0022 settles it: one folder the machine mounts, with the
// product's state and secrets inside it. The rule that keeps a container out of them is the
// mapping's, so the names live here, beside the rule, rather than in a caller that could forget.
const (
	// PrivateConfig is the root's private settings folder: the install's `config.json` and,
	// beside it, the provider key and the API token.
	PrivateConfig = "config"
	// PrivateState is the root's state folder: conversations, the workspace registry, drafts.
	PrivateState = "state"
	// SharedConfig is the one file inside the private config folder that every workspace may
	// read: the install's settings, mounted read-only (docs/adr/0014). It is not a secret, which
	// is why it is the one exception.
	SharedConfig = "config.json"
)

// bindPath is one bind, refused unless it is a path a container may see: inside the share root,
// never the root itself, and never anything private under it.
//
// Both directions matter. A path outside the root is a door nobody declared; a path *above* the
// private ones — the root, or a private folder — is a bind that would hand a container every
// workspace at once, and the provider key with them (ADR 0022's price, paid in policy here).
func bindPath(root, path string, readOnly bool) (Bind, error) {
	clean := filepath.Clean(path)
	if !layout.Under(root, clean) {
		return Bind{}, fmt.Errorf("sandbox: %s is outside the share root %s, so the machine's VM cannot see it", clean, root)
	}
	if clean == filepath.Clean(root) {
		return Bind{}, fmt.Errorf("sandbox: %s is the share root itself: a container bound there would see every workspace and the install's own files", clean)
	}
	for _, private := range []string{filepath.Join(root, PrivateConfig), filepath.Join(root, PrivateState)} {
		// The folder itself, or anything inside it: Under excludes the folder it is given, because
		// everywhere else the path being tested must not *be* the thing, and here it must be caught.
		if clean != private && !layout.Under(private, clean) {
			continue
		}
		if clean == filepath.Join(root, PrivateConfig, SharedConfig) {
			continue
		}
		return Bind{}, fmt.Errorf("sandbox: %s is the share root's private files (%s): the provider key and the product's state are not a container's business", clean, private)
	}
	// A path that is not there yet is not a file: the runtime skips a missing mount (`optional`),
	// and the kind it was told is the kind it would have made.
	info, err := os.Stat(clean)
	return Bind{Source: clean, Target: clean, ReadOnly: readOnly, File: err == nil && !info.IsDir()}, nil
}

// Memory as a policy writes it: a whole number and a binary unit, because "2G" in a policy
// means 2 GiB and a cgroup's memory.max counts bytes. A bare number is bytes. A fraction, an
// unknown unit, or zero is refused by name: a container silently rounded to a limit nobody
// wrote is worse than a policy that says what it cannot do.
const (
	kib = 1 << 10
	mib = 1 << 20
	gib = 1 << 30
	tib = 1 << 40
)

func parseMemory(value string) (int64, error) {
	text := strings.ToUpper(strings.TrimSpace(value))
	// "2GiB", "2Gi", "2GIB" and "2g" all name the same size.
	text = strings.TrimSuffix(text, "B")
	if before, found := strings.CutSuffix(text, "I"); found && before != "" && strings.ContainsRune("KMGT", rune(before[len(before)-1])) {
		text = before
	}
	unit := int64(1)
	for _, candidate := range []struct {
		suffix string
		bytes  int64
	}{{"K", kib}, {"M", mib}, {"G", gib}, {"T", tib}} {
		if strings.HasSuffix(text, candidate.suffix) {
			unit = candidate.bytes
			text = strings.TrimSuffix(text, candidate.suffix)
			break
		}
	}
	count, err := strconv.ParseInt(strings.TrimSpace(text), 10, 64)
	if err != nil {
		return 0, fmt.Errorf("sandbox: memory %q is not a size (512M, 2G, or bytes): %w", value, err)
	}
	if count <= 0 {
		return 0, fmt.Errorf("sandbox: memory %q is not a size: a container needs more than zero bytes", value)
	}
	if count > math.MaxInt64/unit {
		return 0, fmt.Errorf("sandbox: memory %q is more than this machine can count", value)
	}
	return count * unit, nil
}
