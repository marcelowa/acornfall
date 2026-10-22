// Package sandbox keeps every model-driven touch of the world inside one microVM per
// workspace: commands, file reads, file writes, and the workspace's own resource files.
// See docs/adr/0012-sandbox.md for the decision and the measurements behind it.
//
// Control owns the sandbox's life (this package: install the engine, create, start, stop,
// remove) and the worker owns execution inside it (the engine's SDK, in worker/src/sandbox).
// The two speak to the same engine and the same state, which is why one side can be Go and
// the other JavaScript.
package sandbox

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Policy is a workspace's intent for its sandbox. It says what the workspace needs; how that
// becomes an engine's configuration is the driver's business, which is why the engine's own
// vocabulary does not appear here. It is the whole policy: what the sandbox
// is made of, how big it may get, whether it may reach the network, whether it may nest
// virtual machines, and which host folder it may see. The engine reads it as sandbox.yaml.
type Policy struct {
	// Image is the project's environment — Go, Rust, Python, Node, Ruby, whatever the work
	// needs. It is deliberately not the worker's runtime: the worker is not in here.
	Image string
	// CPUs and Memory bound the sandbox. Zero values take the defaults.
	CPUs   int
	Memory string
	// DisableVMNesting is whether this workspace must not nest virtual machines inside its
	// sandbox. False (the default) allows nesting wherever the engine offers it and this
	// machine can grant it; true refuses it, and the engine is told so explicitly where
	// it has the switch. A sandbox on a machine that cannot nest still boots. See
	// docs/adr/0018-disable-vm-nesting.md.
	DisableVMNesting bool
	// Privileged runs this workspace's container as root in the machine instead of inside a user
	// namespace. It is the sharpest trade ADR 0021 names: the unprivileged profile is the default
	// because a user namespace is the mitigation, and a workspace that asks for more unreachable
	// things (its own mounts, its own devices) is asking for this. A workspace that does not ask
	// gets the default.
	Privileged bool
	// Egress allows the sandbox to reach the network. On by default for new workspaces;
	// ADR 0012 records what that exposes.
	Egress bool
	// Workspace is the host folder mounted into the sandbox at the same path, which is what
	// makes a path mean the same thing on both sides.
	Workspace string
	// Global lists host resource folders the sandbox mounts read-only at their own paths: the
	// user's `~/.agents` bundle and the install's agents, skills, and prompt templates. A
	// skill's instructions can then name `scripts/check.sh` and have it be a command that
	// works. Read-only because editing them is self-modification, which belongs behind review
	// (issue #17). GlobalPaths builds it.
	Global []string
	// IdleTimeout stops a sandbox nobody is using. Empty takes the default. NoIdleStop says
	// the sandbox must never be stopped for being idle, which is what the machine uses.
	IdleTimeout string
	// Owned lists paths inside the workspace that belong to the sandbox rather than to the
	// user's folder, so that build artifacts cannot fight between host and guest. Not used
	// yet, deliberately: see ADR 0012, "Not doing now, on purpose".
	Owned []string
}

// Defaults, chosen to be unremarkable. The image matches this host's libc family so that
// artifacts already in the workspace can still run; the timeout is long enough that a
// workspace with dependencies installed is not rebuilt between two questions.
const (
	DefaultImage       = "debian:stable-slim"
	DefaultCPUs        = 2
	DefaultMemory      = "2G"
	DefaultIdleTimeout = "30m"
	// NoIdleStop is a policy's way of saying "never stop this sandbox for being idle". The
	// engine has no value for it — measured on the pin: an omitted idle_timeout is what it
	// reads as no idle stop, while `0s` stops the sandbox at once — so the renderer writes no
	// key at all. A long duration would be a number nobody chose, and one that eventually
	// stops the machine out from under every workspace at once.
	NoIdleStop = "never"
)

func (p Policy) withDefaults() Policy {
	if strings.TrimSpace(p.Image) == "" {
		p.Image = DefaultImage
	}
	if p.CPUs <= 0 {
		p.CPUs = DefaultCPUs
	}
	if strings.TrimSpace(p.Memory) == "" {
		p.Memory = DefaultMemory
	}
	if strings.TrimSpace(p.IdleTimeout) == "" {
		p.IdleTimeout = DefaultIdleTimeout
	}
	return p
}

// The bundle is one tree: the global skills, agents, prompts and commands, in the folder the
// machine mounts (ADR 0022). It used to be two layers — the user's `~/.agents` and the install's
// own four folders — and one tree is what the one-bundle shape buys: a skill's own directory is
// the same string for the worker, for the model, and for a container's bind.
const ecosystemDir = ".agents"

// GlobalPaths is what a workspace's sandbox mounts read-only at the same paths: the bundle in
// full, and the install's config file when it exists. A file is only mountable if it is there
// when the sandbox is created, so config.json is included when it exists and not otherwise;
// adding one later needs the sandbox recreated.
//
// The install's own folder is deliberately absent, and so is everything else in the root that a
// container has no business reading: `config/` holds the provider credential and the token, and
// `state/` holds every workspace's conversations. The mapping refuses those paths in both
// directions (see bindPath). docs/adr/0014-global-resources-in-the-sandbox.md,
// docs/adr/0022-the-appliance-runs-in-the-machine.md.
func GlobalPaths(share string) []string {
	paths := []string{filepath.Join(share, ecosystemDir)}
	config := filepath.Join(share, "config", "config.json")
	if info, err := os.Stat(config); err == nil && !info.IsDir() {
		paths = append(paths, config)
	}
	return paths
}

// EnsureGlobal creates the folders GlobalPaths names, so a fresh install has somewhere to
// mount from. It does not create config.json: an empty one would be a decision about defaults
// nobody made, and the mount is skipped while the file is absent.
func EnsureGlobal(share string) error {
	folder := filepath.Join(share, ecosystemDir)
	if err := os.MkdirAll(folder, 0o700); err != nil {
		return fmt.Errorf("create %s: %w", folder, err)
	}
	return nil
}

// Name is the engine-level name for a workspace's sandbox. It is derived from the path so
// that two gateways pointed at one folder agree on which sandbox is which, and readable so
// that `msb ls` means something to a person.
func Name(workspace string) string {
	slug := slugify(base(workspace))
	return fmt.Sprintf("acornfall-%s-%s", slug, shortHash(workspace))
}

// shortHash tells two workspaces apart that end in the same folder name.
func shortHash(value string) string {
	sum := sha256.Sum256([]byte(value))
	return hex.EncodeToString(sum[:4])
}

func base(path string) string {
	trimmed := strings.TrimRight(path, "/")
	if trimmed == "" {
		return "workspace"
	}
	if _, after, ok := strings.CutLast(trimmed, "/"); ok {
		return after
	}
	return trimmed
}

// slugify keeps a name inside what the engine accepts and a human can read.
func slugify(value string) string {
	var b strings.Builder
	for _, r := range strings.ToLower(value) {
		switch {
		case r >= 'a' && r <= 'z', r >= '0' && r <= '9':
			b.WriteRune(r)
		case r == '-' || r == '_' || r == '.':
			b.WriteRune('-')
		}
		if b.Len() >= 24 {
			break
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		return "ws"
	}
	return out
}
