// Package layout is where an install keeps its files, in one place, so that the two folders
// ADR 0022 settled cannot drift apart in fifteen callers.
//
// The rule: **the root holds what the product is; the home holds what runs it.** The root is the
// one folder the machine mounts, so everything in it is visible to the machine and its
// containers — the workspaces, the global bundle, the config, the state. The home holds the
// machinery: the engine's install and its store, which contains the file that *is* the machine's
// disk and therefore must never be inside the mount.
//
//	~/acornfall/            the root: the product
//	  .agents/              global skills, agents, prompts, commands — one bundle, no layers
//	  config/               config.json, settings.json, credentials.json, token
//	  state/                conversations, drafts, the workspace registry
//	  workspaces/<name>/    a workspace
//	~/.acornfall/           the home: the machinery
//	  tools/                the engine's install
//	  sandboxes/            its store
package layout

import (
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Layout is one install's two folders.
type Layout struct {
	// Root is the folder the machine mounts: the product's files.
	Root string
	// Home is the machinery: the engine, its store, and the install's own bookkeeping.
	Home string
}

// New names both folders. Neither is created here: a caller that wants them makes them, and
// Ensure does it.
func New(root, home string) Layout { return Layout{Root: root, Home: home} }

// Root is the folder the machine mounts. It is the one path a container's binds are relative to.
func (l Layout) Bundle() string { return filepath.Join(l.Root, ".agents") }

// ConfigDir is where the install's own settings and secrets live: config.json, settings.json,
// credentials.json, token. It is inside the mount, which is a decision with a price (ADR 0022),
// and the mapping that keeps it out of containers is in internal/sandbox.
func (l Layout) ConfigDir() string { return filepath.Join(l.Root, "config") }

// ConfigFile is the install's configuration, which every workspace reads and a sandbox mounts
// read-only.
func (l Layout) ConfigFile() string { return filepath.Join(l.ConfigDir(), "config.json") }

// SettingsFile is the install-wide defaults: the model every workspace falls back to.
func (l Layout) SettingsFile() string { return filepath.Join(l.ConfigDir(), "settings.json") }

// Credentials is the provider credential the worker uses. It is inside the mount, which is
// ADR 0022's trade, and nothing binds it.
func (l Layout) Credentials() string { return filepath.Join(l.ConfigDir(), "credentials.json") }

// Token is the API token, when the gateway listens on an address that needs one.
func (l Layout) Token() string { return filepath.Join(l.ConfigDir(), "token") }

// StateDir is the product's own state: conversations, drafts, and the registry.
func (l Layout) StateDir() string { return filepath.Join(l.Root, "state") }

// WorkspaceState is one workspace's folder inside the state directory: its storage, its
// settings, its drafts.
func (l Layout) WorkspaceState(name string) string { return filepath.Join(l.StateDir(), name) }

// Registry lists the install's workspaces.
func (l Layout) Registry() string { return filepath.Join(l.StateDir(), "workspaces.json") }

// Workspaces is where a workspace's folder is created.
func (l Layout) Workspaces() string { return filepath.Join(l.Root, "workspaces") }

// Tools is the engine's install.
func (l Layout) Tools() string { return filepath.Join(l.Home, "tools") }

// Store is the engine's own store: images, sandboxes, and the machine's disk.
func (l Layout) Store() string { return filepath.Join(l.Home, "sandboxes") }

// Ensure creates both folders and the shape inside them, so a fresh install has somewhere to
// write and a sandbox has somewhere to mount from.
func (l Layout) Ensure() error {
	for _, dir := range []string{l.Root, l.Bundle(), l.ConfigDir(), l.StateDir(), l.Workspaces(), l.Home, l.Tools(), l.Store()} {
		if err := os.MkdirAll(dir, 0o700); err != nil {
			return fmt.Errorf("layout: creating %s: %w", dir, err)
		}
	}
	return nil
}

// The old install kept everything in one folder. These are the public files that moved to the
// root, in the order a person would look for them.
var moved = []struct {
	name string
	to   func(Layout) string
}{
	{"agents", func(l Layout) string { return filepath.Join(l.Bundle(), "agents") }},
	{"skills", func(l Layout) string { return filepath.Join(l.Bundle(), "skills") }},
	{"prompts", func(l Layout) string { return filepath.Join(l.Bundle(), "prompts") }},
	{"commands", func(l Layout) string { return filepath.Join(l.Bundle(), "commands") }},
	{"config.json", func(l Layout) string { return l.ConfigFile() }},
	{"settings.json", func(l Layout) string { return l.SettingsFile() }},
	{"credentials.json", func(l Layout) string { return l.Credentials() }},
	{"token", func(l Layout) string { return l.Token() }},
	// The state folder first, so the registry that belongs inside it lands in a folder that is
	// already the moved one.
	{"state", func(l Layout) string { return l.StateDir() }},
	{"workspaces.json", func(l Layout) string { return l.Registry() }},
	// The single-workspace layout that came before the workspace layout: it is state, and the
	// migration that follows this one moves it into the general workspace's folder.
	{"session.sqlite", func(l Layout) string { return filepath.Join(l.StateDir(), "session.sqlite") }},
	{"session.sqlite-wal", func(l Layout) string { return filepath.Join(l.StateDir(), "session.sqlite-wal") }},
	{"session.sqlite-shm", func(l Layout) string { return filepath.Join(l.StateDir(), "session.sqlite-shm") }},
}

// Migrate moves an install that kept its public files in the home onto the two-folder layout.
// It runs once in practice and is idempotent in principle: a file that is already at its
// destination is left alone, and one that is not there at all is not a mistake.
//
// Secrets move with the rest. They are moving between two folders the same install owns, and
// leaving them behind would be an install that starts with no provider.
func Migrate(l Layout, log func(string, ...any)) error {
	if err := l.Ensure(); err != nil {
		return err
	}
	for _, move := range moved {
		from := filepath.Join(l.Home, move.name)
		source, err := os.Stat(from)
		if err != nil {
			continue
		}
		to := move.to(l)
		if info, err := os.Stat(to); err == nil {
			// A folder source may find an empty folder here: Ensure just made it, and it is a
			// destination with nothing in it. A *file* source never replaces anything — a file
			// renamed onto a folder is a folder turned into a file, which is not a migration, it is
			// a disaster — so it is skipped like any other destination that is already there.
			replaceable := source.IsDir() && info.IsDir() && emptyDir(to)
			if !replaceable {
				// An install that has run with the new layout already: the old copy is left where it is
				// rather than deleted, because a migration that removes things is one nobody can undo.
				continue
			}
			if err := os.Remove(to); err != nil {
				return err
			}
		}
		if err := os.MkdirAll(filepath.Dir(to), 0o700); err != nil {
			return err
		}
		if err := os.Rename(from, to); err != nil {
			return fmt.Errorf("layout: moving %s to %s: %w", from, to, err)
		}
		if log != nil {
			log("moved %s to %s", from, to)
		}
	}
	return nil
}

// Under reports whether path is inside root, and not the root itself. Both halves matter to the
// callers: a path outside the mount cannot be bound into a container, and the root *is* every
// workspace at once — a bind of it, or a workspace that is it, hands a container the lot.
func Under(root, path string) bool {
	clean, target := filepath.Clean(root), filepath.Clean(path)
	if clean == target {
		return false
	}
	relative, err := filepath.Rel(clean, target)
	if err != nil {
		return false
	}
	return relative != ".." && !strings.HasPrefix(relative, ".."+string(filepath.Separator))
}

// emptyDir reports whether a folder holds nothing, which is the difference between a destination
// a migration has already filled and one an install just created.
func emptyDir(path string) bool {
	entries, err := os.ReadDir(path)
	return err == nil && len(entries) == 0
}

// ErrNoRoot is what a caller gets when the root is not set: a layout with no root is a machine
// with no door, and guessing one is how a bind reaches something nobody chose.
var ErrNoRoot = errors.New("layout: the root folder is not set")
