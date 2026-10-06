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
	"strings"
)

// Policy is a workspace's intent for its sandbox. It says what the workspace needs; how that
// becomes an engine's configuration is the driver's business, which is why the engine's own
// vocabulary does not appear here. It is the whole policy: what the sandbox
// is made of, how big it may get, whether it may reach the network, and which host folder
// it may see. The engine reads it as sandbox.yaml.
type Policy struct {
	// Image is the project's environment — Go, Rust, Python, Node, Ruby, whatever the work
	// needs. It is deliberately not the worker's runtime: the worker is not in here.
	Image string
	// CPUs and Memory bound the sandbox. Zero values take the defaults.
	CPUs   int
	Memory string
	// Egress allows the sandbox to reach the network. On by default for new workspaces;
	// ADR 0012 records what that exposes.
	Egress bool
	// Workspace is the host folder mounted into the sandbox at the same path, which is what
	// makes a path mean the same thing on both sides.
	Workspace string
	// IdleTimeout stops a sandbox nobody is using. Empty takes the default.
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
	if index := strings.LastIndex(trimmed, "/"); index >= 0 {
		return trimmed[index+1:]
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
