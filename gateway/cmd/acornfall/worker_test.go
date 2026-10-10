package main

import (
	"os"
	"path/filepath"
	"slices"
	"testing"
)

func TestResolveWorkerCommandPrefersExplicit(t *testing.T) {
	got := resolveWorkerCommand("bun run --bun src/main.ts", "/bin/worker", "ENV_WORKER")
	if !slices.Equal(got, []string{"bun", "run", "--bun", "src/main.ts"}) {
		t.Fatalf("explicit command must win, got %q", got)
	}
}

func TestResolveWorkerCommandPrefersBinFlagOverEnv(t *testing.T) {
	got := resolveWorkerCommand("", "/bin/flag-worker", "/bin/env-worker")
	if !slices.Equal(got, []string{"/bin/flag-worker"}) {
		t.Fatalf("bin flag must win over env, got %q", got)
	}
}

func TestResolveWorkerCommandFallsBackToBun(t *testing.T) {
	// No flag, no env, and no acornfall-worker beside the test binary: bun.
	dir := t.TempDir()
	got := resolveWorkerCommandWithExe("", "", "", filepath.Join(dir, "acornfall"))
	if !slices.Equal(got, []string{"bun", "run", "src/main.ts"}) {
		t.Fatalf("want bun default, got %q", got)
	}
}

func TestResolveWorkerCommandFindsBesideExecutable(t *testing.T) {
	dir := t.TempDir()
	candidate := filepath.Join(dir, "acornfall-worker")
	if err := os.WriteFile(candidate, []byte("x"), 0o755); err != nil {
		t.Fatal(err)
	}
	fakeExe := filepath.Join(dir, "acornfall")
	got := resolveWorkerCommandWithExe("", "", "", fakeExe)
	if !slices.Equal(got, []string{candidate}) {
		t.Fatalf("worker beside the gateway must win, got %q", got)
	}
}
