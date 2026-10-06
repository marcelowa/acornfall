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
	// Global lists host resource folders the sandbox mounts read-only at their own paths: the
	// user's `~/.agents` bundle and the install's agents, skills, and prompt templates. A
	// skill's instructions can then name `scripts/check.sh` and have it be a command that
	// works. Read-only because editing them is self-modification, which belongs behind review
	// (issue #17). GlobalPaths builds it.
	Global []string
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

// ecosystemDir is the rest of the ecosystem's name for a resource bundle. The worker reads
// it as well as the install's own folders, so a bundle written for another harness works
// here, and the sandbox has to see the same paths the worker read the instructions from.
const ecosystemDir = ".agents"

// globalFolders are the install's resource folders, which exist in every install so that a
// sandbox's mount always resolves: the user's bundle in full, then the install's own. The
// prompt-template folder has two names because both are read.
func globalFolders(home, userHome string) []string {
	folders := []string{filepath.Join(userHome, ecosystemDir)}
	for _, name := range []string{"agents", "skills", "prompts", "commands"} {
		folders = append(folders, filepath.Join(home, name))
	}
	return folders
}

// GlobalPaths is what a workspace's sandbox mounts read-only at the same paths. A file is
// only mountable if it is there when the sandbox is created, so `<home>/config.json` is
// included when it exists and not otherwise; adding one later needs the sandbox recreated.
//
// `<home>` itself is deliberately absent: it holds credentials.json, token, and state/, and
// the agent has no business reading any of them. That is the whole reason the list is
// explicit. See docs/adr/0014-global-resources-in-the-sandbox.md.
func GlobalPaths(home, userHome string) []string {
	paths := globalFolders(home, userHome)
	config := filepath.Join(home, "config.json")
	if info, err := os.Stat(config); err == nil && !info.IsDir() {
		paths = append(paths, config)
	}
	return paths
}

// EnsureGlobal creates the folders GlobalPaths names, so a fresh install has somewhere to
// mount from. It does not create config.json: an empty one would be a decision about
// defaults nobody made, and the mount is skipped while the file is absent.
func EnsureGlobal(home, userHome string) error {
	for _, folder := range globalFolders(home, userHome) {
		if err := os.MkdirAll(folder, 0o700); err != nil {
			return fmt.Errorf("create %s: %w", folder, err)
		}
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
