// Package workerpool spawns and supervises one harness worker per workspace.
package workerpool

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"os/exec"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/acornfall/acornfall/gateway/internal/protocol"
)

// Config describes how to start a worker process.
type Config struct {
	// Command is the executable, e.g. "bun".
	Command string
	// Args follow the executable, e.g. worker/src/main.ts --workspace ... .
	Args []string
	// Dir is the working directory for the process.
	Dir string
}

// stderrKept is how many lines of harness diagnostics are kept for a failure message.
const stderrKept = 12

// Worker owns one worker process and speaks the JSONL protocol to it.
type Worker struct {
	config Config

	mu      sync.Mutex
	cmd     *exec.Cmd
	stdin   io.WriteCloser
	pending map[string]chan protocol.Frame
	nextID  atomic.Int64
	closed  bool
	// stderr is the tail of what the harness said, kept for a failure message.
	stderr []string

	frameMu sync.RWMutex
	handler func(protocol.Frame)

	exitMu  sync.RWMutex
	onExit  func(error)
	exited  chan struct{}
	waitErr error
}

func New(config Config) *Worker {
	return &Worker{config: config, pending: map[string]chan protocol.Frame{}, exited: make(chan struct{})}
}

// OnExit registers the single observer of this process's end. Control needs it: a dead
// worker is otherwise indistinguishable from a quiet one, because every read control
// serves comes from its own cache.
func (w *Worker) OnExit(handler func(error)) {
	w.exitMu.Lock()
	defer w.exitMu.Unlock()
	w.onExit = handler
}

// Exited is closed once the process has ended and been reaped.
func (w *Worker) Exited() <-chan struct{} { return w.exited }

// WaitErr reports why the process ended, once it has.
func (w *Worker) WaitErr() error { return w.waitErr }

// Alive reports whether the process is still running.
func (w *Worker) Alive() bool {
	select {
	case <-w.exited:
		return false
	default:
		return true
	}
}

// OnFrame registers the single consumer of unprompted frames. Call before Start.
func (w *Worker) OnFrame(handler func(protocol.Frame)) {
	w.frameMu.Lock()
	defer w.frameMu.Unlock()
	w.handler = handler
}

// Start launches the process and begins reading frames. It returns once the
// worker has been spawned; protocol readiness is proven by the first Call.
func (w *Worker) Start(ctx context.Context) error {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.cmd != nil {
		return errors.New("worker already started")
	}
	// Deliberately not CommandContext: a worker's lifetime belongs to whoever owns the
	// pool, not to the request that happened to start it. With a request context, the
	// process was killed the moment that request finished, which looked like a worker
	// crashing on startup. Close() is what ends it.
	_ = ctx
	cmd := exec.Command(w.config.Command, w.config.Args...)
	if w.config.Dir != "" {
		cmd.Dir = w.config.Dir
	}
	stdin, err := cmd.StdinPipe()
	if err != nil {
		return err
	}
	stdout, err := cmd.StdoutPipe()
	if err != nil {
		return err
	}
	stderr, err := cmd.StderrPipe()
	if err != nil {
		return err
	}
	if err := cmd.Start(); err != nil {
		return err
	}
	w.cmd = cmd
	w.stdin = stdin
	go w.readStdout(stdout)
	go w.readStderr(stderr)
	// Reap the process and announce it once, however it ended.
	go func() {
		waitErr := cmd.Wait()
		w.exitMu.Lock()
		w.waitErr = waitErr
		handler := w.onExit
		w.exitMu.Unlock()
		close(w.exited)
		w.fail(errors.New("worker process ended"))
		if handler != nil {
			handler(waitErr)
		}
	}()
	return nil
}

// Call sends one command and waits for its response.
func (w *Worker) Call(ctx context.Context, command protocol.Command) (json.RawMessage, error) {
	if command.ID == "" {
		command.ID = fmt.Sprintf("c%d", w.nextID.Add(1))
	}
	payload, err := command.Marshal()
	if err != nil {
		return nil, err
	}

	w.mu.Lock()
	if w.closed || w.stdin == nil {
		w.mu.Unlock()
		return nil, errors.New("worker is not running")
	}
	waiter := make(chan protocol.Frame, 1)
	w.pending[command.ID] = waiter
	if _, err := w.stdin.Write(append(payload, '\n')); err != nil {
		delete(w.pending, command.ID)
		w.mu.Unlock()
		return nil, fmt.Errorf("write to worker: %w", err)
	}
	w.mu.Unlock()

	select {
	case frame := <-waiter:
		if !frame.OK {
			return nil, errors.New(frame.Error)
		}
		return frame.Data, nil
	case <-ctx.Done():
		w.mu.Lock()
		delete(w.pending, command.ID)
		w.mu.Unlock()
		return nil, ctx.Err()
	}
}

// CallInto sends a command and decodes its response data into out.
func (w *Worker) CallInto(ctx context.Context, command protocol.Command, out any) error {
	data, err := w.Call(ctx, command)
	if err != nil {
		return err
	}
	if out == nil || len(data) == 0 {
		return nil
	}
	return json.Unmarshal(data, out)
}

// Close sends shutdown and waits briefly for the process to end.
func (w *Worker) Close() {
	w.mu.Lock()
	if w.closed {
		w.mu.Unlock()
		return
	}
	w.closed = true
	stdin := w.stdin
	cmd := w.cmd
	w.mu.Unlock()

	if stdin != nil {
		_ = stdin.Close()
	}
	if cmd == nil {
		return
	}
	select {
	case <-w.exited:
	case <-time.After(5 * time.Second):
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		<-w.exited
	}
}

func (w *Worker) readStdout(stdout io.Reader) {
	scanner := bufio.NewScanner(stdout)
	scanner.Buffer(make([]byte, 0, 1<<20), 64<<20)
	for scanner.Scan() {
		line := scanner.Bytes()
		var frame protocol.Frame
		if err := json.Unmarshal(line, &frame); err != nil {
			continue
		}
		if frame.Type == "response" {
			w.mu.Lock()
			waiter, ok := w.pending[frame.ID]
			delete(w.pending, frame.ID)
			w.mu.Unlock()
			if ok {
				waiter <- frame
				continue
			}
		}
		w.frameMu.RLock()
		handler := w.handler
		w.frameMu.RUnlock()
		if handler != nil {
			handler(frame)
		}
	}
	// Settle waiters; the reaper announces the exit.
	w.fail(errors.New("worker stdout closed"))
}

func (w *Worker) readStderr(stderr io.Reader) {
	scanner := bufio.NewScanner(stderr)
	scanner.Buffer(make([]byte, 0, 64*1024), 256*1024)
	for scanner.Scan() {
		line := scanner.Text()
		Log("worker: %s", line)
		w.rememberStderr(line)
	}
}

// rememberStderr keeps the tail of what the harness said, so a failure can be explained
// where it is seen instead of only in the gateway's log. Bounded on purpose: this is a
// diagnosis, not a log file.
func (w *Worker) rememberStderr(line string) {
	w.mu.Lock()
	w.stderr = append(w.stderr, line)
	if len(w.stderr) > stderrKept {
		w.stderr = w.stderr[len(w.stderr)-stderrKept:]
	}
	w.mu.Unlock()
}

// LastWords is the most informative line the harness printed before it died: the one that
// says something went wrong, or the last thing it said. A stack trace on stderr is normal
// output for a crash, and its last line is the least useful one.
func (w *Worker) LastWords() string {
	w.mu.Lock()
	defer w.mu.Unlock()
	for index := len(w.stderr) - 1; index >= 0; index-- {
		if strings.Contains(strings.ToLower(w.stderr[index]), "error:") {
			return strings.TrimSpace(w.stderr[index])
		}
	}
	for index := len(w.stderr) - 1; index >= 0; index-- {
		if trimmed := strings.TrimSpace(w.stderr[index]); trimmed != "" && !strings.HasPrefix(trimmed, "Bun v") {
			return trimmed
		}
	}
	return ""
}

// fail settles every waiter so callers do not hang when the process dies.
func (w *Worker) fail(cause error) {
	w.mu.Lock()
	pending := w.pending
	w.pending = map[string]chan protocol.Frame{}
	w.mu.Unlock()
	for _, waiter := range pending {
		select {
		case waiter <- protocol.Frame{OK: false, Error: cause.Error()}:
		default:
		}
	}
}
