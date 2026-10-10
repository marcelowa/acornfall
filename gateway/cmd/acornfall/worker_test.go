package main

import (
	"os"
	"path/filepath"
	"slices"
	"testing"

	"github.com/acornfall/acornfall/gateway/internal/update"
)

func TestResolveWorkerPrefersExplicit(t *testing.T) {
	manager := update.New(t.TempDir(), "", "")
	got, _, managed := resolveWorker("bun run --bun src/main.ts", "", "", manager)
	if !slices.Equal(got, []string{"bun", "run", "--bun", "src/main.ts"}) {
		t.Fatalf("explicit command must win, got %q", got)
	}
	if managed {
		t.Fatal("explicit command is never managed")
	}
}

func TestResolveWorkerPrefersBinFlag(t *testing.T) {
	manager := update.New(t.TempDir(), "", "")
	got, dir, managed := resolveWorker("", "", "/bin/worker", manager)
	if !slices.Equal(got, []string{"/bin/worker"}) || dir != "" || managed {
		t.Fatalf("bin flag must win unmanaged: %q %q %v", got, dir, managed)
	}
}

func TestResolveWorkerDirFlagUsesSystemBun(t *testing.T) {
	home := t.TempDir()
	manager := update.New(home, "", "")
	sources := t.TempDir()
	if err := os.MkdirAll(filepath.Join(sources, "src"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(sources, "src", "main.ts"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	got, dir, managed := resolveWorker("", sources, "", manager)
	if !slices.Equal(got, []string{"bun", "run", "src/main.ts"}) {
		t.Fatalf("worker dir must mean system bun, got %q", got)
	}
	if managed || dir != sources {
		t.Fatalf("worker dir keeps dev resolution: dir=%q managed=%v", dir, managed)
	}
}

func TestResolveWorkerDefaultsToManaged(t *testing.T) {
	home := t.TempDir()
	manager := update.New(home, "", "")
	got, dir, managed := resolveWorker("", "", "", manager)
	if !managed {
		t.Fatal("default worker must be managed")
	}
	if !slices.Equal(got, []string{manager.BunPath(), "run", "src/main.ts"}) {
		t.Fatalf("managed command must be ensured bun, got %q", got)
	}
	if dir != manager.WorkerDir() {
		t.Fatalf("managed dir must be ensured sources, got %q", dir)
	}
}

func TestVersionStringReadsFile(t *testing.T) {
	home := t.TempDir()
	if err := os.WriteFile(home+"/version", []byte("v0.9.0\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	version, err := versionString(home)
	if err != nil || version != "v0.9.0" {
		t.Fatalf("version = %q, %v", version, err)
	}
}

func TestVersionStringFallsBackToDev(t *testing.T) {
	version, err := versionString(t.TempDir())
	if err != nil || version != "dev" {
		t.Fatalf("fresh home must read dev, got %q, %v", version, err)
	}
}
