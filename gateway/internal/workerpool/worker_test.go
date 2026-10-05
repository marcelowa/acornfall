package workerpool

import (
	"strings"
	"testing"
)

// A failure message is only useful if it says what went wrong. "exit status 1" does not; the
// line the harness printed does, and it is usually not the last one — a stack trace follows it.
func TestLastWordsPrefersTheLineThatExplains(t *testing.T) {
	worker := New(Config{})
	for _, line := range []string{
		"172 | if (reason === \"\") throw new Error(`${path}: a guard needs a reason`)",
		"error: /tmp/ws/.acornfall/config.json: a guard needs a reason, because the model is told it",
		"      at parseGuard (/worker/src/config.ts:173:31)",
		"      at async loadCatalog (/worker/src/config.ts:320:42)",
		"",
		"Bun v1.4.0 (Linux x64)",
	} {
		worker.rememberStderr(line)
	}

	words := worker.LastWords()
	if !strings.Contains(words, "a guard needs a reason") {
		t.Errorf("expected the error line, got %q", words)
	}
	if strings.Contains(words, "parseGuard") {
		t.Errorf("a stack frame is not the reason, got %q", words)
	}
}

// Without an error line, the last thing it said is the best available answer — but not the
// runtime banner, which says nothing at all.
func TestLastWordsWithoutAnError(t *testing.T) {
	worker := New(Config{})
	worker.rememberStderr("worker starting up")
	worker.rememberStderr("")
	worker.rememberStderr("Bun v1.4.0 (Linux x64)")
	if got := worker.LastWords(); got != "worker starting up" {
		t.Errorf("expected the last real line, got %q", got)
	}

	empty := New(Config{})
	if got := empty.LastWords(); got != "" {
		t.Errorf("a silent worker has no last words, got %q", got)
	}
}

// The tail is bounded: this is a diagnosis, not a log.
func TestStderrTailIsBounded(t *testing.T) {
	worker := New(Config{})
	for i := 0; i < stderrKept*3; i++ {
		worker.rememberStderr("line")
	}
	worker.mu.Lock()
	kept := len(worker.stderr)
	worker.mu.Unlock()
	if kept != stderrKept {
		t.Errorf("expected at most %d lines kept, got %d", stderrKept, kept)
	}
}
