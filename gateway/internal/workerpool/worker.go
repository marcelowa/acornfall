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

// Worker owns one worker process and speaks the JSONL protocol to it.
type Worker struct {
	config Config

	mu      sync.Mutex
	cmd     *exec.Cmd
	stdin   io.WriteCloser
	pending map[string]chan protocol.Frame
	nextID  atomic.Int64
	closed  bool

	frameMu sync.RWMutex
	handler func(protocol.Frame)
}

func New(config Config) *Worker {
	return &Worker{config: config, pending: map[string]chan protocol.Frame{}}
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
	cmd := exec.CommandContext(ctx, w.config.Command, w.config.Args...)
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

// Close sends shutdown and waits briefly for an orderly exit.
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
	done := make(chan struct{})
	go func() {
		_ = cmd.Wait()
		close(done)
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		if cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
		<-done
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
	w.fail(errors.New("worker stdout closed"))
}

func (w *Worker) readStderr(stderr io.Reader) {
	scanner := bufio.NewScanner(stderr)
	for scanner.Scan() {
		Log("worker: %s", scanner.Text())
	}
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
