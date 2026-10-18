package shim

import (
	"bufio"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"os/user"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"syscall"
	"time"
)

// Server answers the protocol by driving the container runtime. Every fact in its behaviour is
// one the spike measured; docs/engineering/lxc-spike.md is the report.
type Server struct {
	// Version is the calling binary's own version, reported at the handshake so a gateway can
	// tell an image's older shim from its own.
	Version string
	// Runner is the runtime's command line. Injected so the logic is tested without a runtime.
	Runner Runner
	// Log reports what the shim does. Nil silences it.
	Log func(string, ...any)
}

// Runner runs the container runtime's command line.
type Runner interface {
	// Run runs to completion and returns its combined output.
	Run(ctx context.Context, args ...string) (string, error)
	// Start starts a command whose output arrives while it runs, and whose process group can be
	// killed as one: the runtime's attach puts the command in the attach's process group, so
	// killing the group is what kills the command inside the container. Killing the attach alone
	// leaves the command running (measured).
	Start(ctx context.Context, args ...string) (Handle, error)
}

// Handle is a running command.
type Handle interface {
	Stdout() io.ReadCloser
	Stderr() io.ReadCloser
	// Kill kills the whole process group: the attach and the command inside the container.
	Kill() error
	// Wait waits for it and reports the exit code. A command killed by a signal reports 137,
	// which is what a shell says for SIGKILL.
	Wait() (int, error)
}

// ExecRunner is the real one: the runtime's own commands, from PATH.
type ExecRunner struct{}

func (ExecRunner) Run(ctx context.Context, args ...string) (string, error) {
	command := exec.CommandContext(ctx, args[0], args[1:]...)
	output, err := command.CombinedOutput()
	text := strings.TrimSpace(string(output))
	if err != nil {
		if text == "" {
			text = err.Error()
		}
		return text, fmt.Errorf("%s: %s", strings.Join(args, " "), firstLine(text))
	}
	return text, nil
}

func (ExecRunner) Start(ctx context.Context, args ...string) (Handle, error) {
	command := exec.CommandContext(ctx, args[0], args[1:]...)
	// Its own process group, so a kill reaches the command the runtime attached and not only
	// the attach: measured, killing the attach alone leaves the command running inside.
	command.SysProcAttr = &syscall.SysProcAttr{Setpgid: true}
	stdout, err := command.StdoutPipe()
	if err != nil {
		return nil, err
	}
	stderr, err := command.StderrPipe()
	if err != nil {
		return nil, err
	}
	if err := command.Start(); err != nil {
		return nil, err
	}
	return &process{command: command, stdout: stdout, stderr: stderr}, nil
}

type process struct {
	command *exec.Cmd
	stdout  io.ReadCloser
	stderr  io.ReadCloser
}

func (p *process) Stdout() io.ReadCloser { return p.stdout }
func (p *process) Stderr() io.ReadCloser { return p.stderr }

func (p *process) Kill() error {
	if p.command.Process == nil {
		return nil
	}
	// The negative pid is the process group; whether the attach has already gone is not an
	// error, because the command inside is what the caller wants stopped.
	err := syscall.Kill(-p.command.Process.Pid, syscall.SIGKILL)
	if errors.Is(err, syscall.ESRCH) {
		return nil
	}
	return err
}

func (p *process) Wait() (int, error) {
	err := p.command.Wait()
	if err == nil {
		return 0, nil
	}
	var failure *exec.ExitError
	if errors.As(err, &failure) {
		if status, ok := failure.Sys().(syscall.WaitStatus); ok && status.Signaled() {
			return 128 + int(status.Signal()), nil
		}
		return failure.ExitCode(), nil
	}
	return -1, err
}

// running is one exec in flight inside a session, so a kill can find it by the id the client
// used for the request that started it.
type running struct {
	name    string
	handle  Handle
	stopped bool
}

// session is one connection: its calls, its execs, and its way of writing. Two gateways may
// share a machine, so a session never touches another's commands: one install's workspace must
// not be stopped by another's connection ending.
type session struct {
	server *Server
	writer *syncWriter
	mu     sync.Mutex
	execs  map[uint64]*running
	// inflight counts the calls being answered, so a connection that ends waits for the replies
	// it asked for instead of dropping them on the floor: a pipe carrying three calls and then
	// EOF is a client that wants three answers, not zero.
	inflight sync.WaitGroup
}

// Serve answers one connection until it closes. Every exec still running when the connection
// ends is killed: a workspace command that outlives the gateway that asked for it is a process
// nobody can see or stop.
func (s *Server) Serve(conn io.ReadWriteCloser) error {
	defer conn.Close()
	current := &session{server: s, writer: &syncWriter{conn: conn}, execs: map[uint64]*running{}}
	defer func() {
		// A connection that ends stops what it started, and only then: an exec still running when
		// the gateway that asked for it is gone is a process nobody can see or stop.
		current.killAll()
		current.inflight.Wait()
	}()
	reader := bufio.NewReader(conn)
	for {
		line, err := reader.ReadBytes('\n')
		if len(line) > 0 {
			var message Message
			if err := unmarshal(line, &message); err != nil {
				return decodeError(err)
			}
			current.inflight.Add(1)
			go func() {
				defer current.inflight.Done()
				current.handle(message)
			}()
		}
		if err != nil {
			if errors.Is(err, io.EOF) {
				return nil
			}
			return err
		}
	}
}

func (s *Server) log(format string, args ...any) {
	if s.Log != nil {
		s.Log(format, args...)
	}
}

func (s *Server) runner() Runner {
	if s.Runner != nil {
		return s.Runner
	}
	return ExecRunner{}
}

// run runs one of the runtime's quick commands. Bounded, because a wedged binary must not hold
// a connection forever; creating a container takes as long as it takes and has its own path.
func (s *Server) run(args ...string) (string, error) {
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	return s.runner().Run(ctx, args...)
}

func (t *session) handle(message Message) {
	if err := t.dispatch(message); err != nil {
		t.fail(message.ID, err)
	}
}

func (t *session) dispatch(message Message) error {
	switch message.Op {
	case OpHello:
		return t.hello(message)
	case OpList:
		return t.list(message)
	case OpCreate:
		payload, err := unmarshalPayload[CreatePayload](message)
		if err != nil {
			return err
		}
		return t.create(message, payload)
	case OpStart, OpStop, OpRemove:
		payload, err := unmarshalPayload[NamePayload](message)
		if err != nil {
			return err
		}
		return t.lifecycle(message, payload.Name)
	case OpExec:
		payload, err := unmarshalPayload[ExecPayload](message)
		if err != nil {
			return err
		}
		return t.exec(message, payload)
	case OpKill:
		payload, err := unmarshalPayload[KillPayload](message)
		if err != nil {
			return err
		}
		t.succeed(message.ID, KillResult{Killed: t.kill(payload.Target)})
		return nil
	default:
		return fmt.Errorf("shim: unknown op %q (protocol %d)", message.Op, Protocol)
	}
}

func (t *session) hello(message Message) error {
	hello := Hello{Protocol: Protocol, Version: t.server.Version}
	if out, err := t.server.run(HelloRuntimeCommand()...); err == nil {
		hello.Runtime = strings.TrimSpace(out)
	}
	if ranges, err := subIDRanges(); err == nil {
		hello.IDs = ranges
	}
	t.succeed(message.ID, hello)
	return nil
}

// HelloRuntimeCommand is what the handshake asks the runtime for its version with. A machine
// without the runtime answers nothing, which is how the gateway refuses with a sentence.
func HelloRuntimeCommand() []string { return []string{"lxc-start", "--version"} }

// subIDRanges is what this machine allows an unprivileged container to map, from /etc/subuid.
// Without a range the container does not start, so the gateway can refuse with a sentence
// instead of a failed create. Lines name a user either way — "root:100000:65536" and
// "0:100000:65536" are both read by this — because a person writes what they are called and a
// tool writes a number.
func subIDRanges() (string, error) {
	data, err := os.ReadFile("/etc/subuid")
	if err != nil {
		return "", err
	}
	names := map[string]bool{fmt.Sprint(os.Getuid()): true}
	if os.Getenv("USER") != "" {
		names[os.Getenv("USER")] = true
	}
	if current, err := user.Current(); err == nil {
		names[current.Username] = true
	}
	var ranges []string
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Split(strings.TrimSpace(line), ":")
		if len(fields) != 3 {
			continue
		}
		if names[fields[0]] {
			ranges = append(ranges, strings.Join(fields, ":"))
		}
	}
	sort.Strings(ranges)
	return strings.Join(ranges, " "), nil
}

func (t *session) list(message Message) error {
	names, err := t.names()
	if err != nil {
		return err
	}
	result := ListResult{Containers: make([]Instance, 0, len(names))}
	for _, name := range names {
		status, err := t.status(name)
		if err != nil {
			return err
		}
		result.Containers = append(result.Containers, Instance{Name: name, Status: status, Running: status == "RUNNING"})
	}
	t.succeed(message.ID, result)
	return nil
}

func (t *session) names() ([]string, error) {
	out, err := t.server.run("lxc-ls", "-1")
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(out) == "" {
		return nil, nil
	}
	return strings.Fields(out), nil
}

func (t *session) status(name string) (string, error) {
	out, err := t.server.run("lxc-info", "-n", name, "-s")
	if err != nil {
		return "", err
	}
	_, state, found := strings.Cut(strings.TrimSpace(out), ":")
	if !found {
		return "", fmt.Errorf("shim: cannot read the state of %s from %q", name, out)
	}
	return strings.ToUpper(strings.TrimSpace(state)), nil
}

func (t *session) lifecycle(message Message, name string) error {
	if name == "" {
		return fmt.Errorf("shim: %s needs a container name", message.Op)
	}
	switch message.Op {
	case OpStart:
		if err := t.start(name); err != nil {
			return err
		}
	case OpStop:
		if _, err := t.server.run("lxc-stop", "-n", name, "-k"); err != nil {
			return err
		}
	case OpRemove:
		// Destroying a running container is refused by the runtime, and "delete this workspace and
		// everything in it" has to work whether or not anything is running: the kill comes first.
		if _, err := t.server.run("lxc-stop", "-n", name, "-k"); err != nil {
			t.server.log("shim: stopping %s before removing it: %v", name, err)
		}
		if _, err := t.server.run("lxc-destroy", "-n", name); err != nil {
			return err
		}
	}
	t.succeed(message.ID, NamePayload{Name: name})
	return nil
}

// start boots a container and refuses to call it started when it is not: the runtime's start
// returns success even when the container's init fails a moment later, and the state is what
// says whether anything is running.
func (t *session) start(name string) error {
	if _, err := t.server.run("lxc-start", "-n", name); err != nil {
		return err
	}
	status, err := t.status(name)
	if err != nil {
		return err
	}
	if status != "RUNNING" {
		return fmt.Errorf("shim: %s is %s after starting it: the image needs a program that stays alive as its init", name, status)
	}
	return nil
}

// create makes the container's rootfs from the image, writes the configuration the gateway
// rendered, and prepares the paths the mounts need. Each of those steps is one the spike found
// to be required, and skipping one is a container that starts and cannot work:
//
//   - the rootfs has to belong to the mapped uid of an unprivileged container, and its folder
//     has to be traversable by it, or it does not start at all (measured);
//   - a bind's parent folder has to exist in the image, because the runtime makes only the leaf
//     and skips the mount silently when the parent is missing (measured);
//   - a bind of a file needs an empty file where it lands, for the same reason.
func (t *session) create(message Message, payload CreatePayload) error {
	if payload.Name == "" || payload.Dir == "" || payload.Config == "" {
		return errors.New("shim: create needs a name, a folder, and a configuration")
	}
	if payload.Image == "" {
		return errors.New("shim: create needs the workspace's image: it becomes the container's rootfs")
	}
	known, err := t.names()
	if err != nil {
		return err
	}
	for _, name := range known {
		if name == payload.Name {
			return fmt.Errorf("shim: %s already exists", payload.Name)
		}
	}
	image := payload.Image
	if !strings.Contains(image, "://") {
		image = "docker://" + image
	}
	// Making a rootfs pulls an image, so it is the one call that is not bounded from here.
	if _, err := t.server.runner().Run(context.Background(), "lxc-create", "-n", payload.Name, "-t", "oci", "--", "-u", image); err != nil {
		return fmt.Errorf("shim: making the rootfs of %s: %w", payload.Name, err)
	}
	rootfs := filepath.Join(payload.Dir, "rootfs")
	if err := os.WriteFile(filepath.Join(payload.Dir, "config"), []byte(payload.Config), 0o644); err != nil {
		return err
	}
	for _, bind := range payload.Binds {
		if err := prepareTarget(rootfs, bind, payload.Owner, payload.Group); err != nil {
			return err
		}
	}
	if payload.Owner > 0 {
		if err := chownTree(rootfs, payload.Owner, payload.Group); err != nil {
			return err
		}
		if err := os.Chmod(payload.Dir, 0o755); err != nil {
			return err
		}
	}
	t.succeed(message.ID, NamePayload{Name: payload.Name})
	return nil
}

// exec runs a command in a running container and reports its output as it arrives. The command
// goes through a shell only when a working directory was asked for, and then the argv travels
// as positional parameters, so nothing in it is parsed twice.
func (t *session) exec(message Message, payload ExecPayload) error {
	if len(payload.Argv) == 0 {
		return errors.New("shim: exec needs a command")
	}
	status, err := t.status(payload.Name)
	if err != nil {
		return err
	}
	if status != "RUNNING" {
		return fmt.Errorf("shim: %s is %s, not running", payload.Name, status)
	}
	args := []string{"lxc-attach", "-n", payload.Name, "--clear-env"}
	// A command with no PATH finds nothing, and the environment the machine happens to have is
	// not the workspace's business: the attach is cleared and the caller's variables are set
	// explicitly.
	args = append(args, "-v", "PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin")
	for _, variable := range payload.Env {
		args = append(args, "-v", variable)
	}
	if payload.UID > 0 {
		args = append(args, "-u", fmt.Sprint(payload.UID))
	}
	if payload.GID > 0 {
		args = append(args, "-g", fmt.Sprint(payload.GID))
	}
	args = append(args, "--")
	if payload.Cwd != "" {
		args = append(args, "sh", "-c", `cd "$1" || exit 1; shift; exec "$@"`, "sh", payload.Cwd)
	}
	args = append(args, payload.Argv...)

	handle, err := t.server.runner().Start(context.Background(), args...)
	if err != nil {
		return err
	}
	current := &running{name: payload.Name, handle: handle}
	t.mu.Lock()
	t.execs[message.ID] = current
	t.mu.Unlock()
	defer func() {
		t.mu.Lock()
		delete(t.execs, message.ID)
		t.mu.Unlock()
	}()

	chunks := make(chan Message, 64)
	var streams sync.WaitGroup
	streams.Add(2)
	go func() { defer streams.Done(); copyOutput(handle.Stdout(), "stdout", message.ID, chunks) }()
	go func() { defer streams.Done(); copyOutput(handle.Stderr(), "stderr", message.ID, chunks) }()
	type outcome struct {
		code int
		err  error
	}
	finished := make(chan outcome, 1)
	go func() {
		code, err := handle.Wait()
		finished <- outcome{code: code, err: err}
		// The output still in the pipes belongs to this command: the channel closes only after
		// both streams have drained, or the last chunk is a lost one.
		streams.Wait()
		close(chunks)
	}()
	for chunk := range chunks {
		t.reply(chunk)
	}
	result := <-finished
	if result.err != nil {
		return fmt.Errorf("shim: running the command in %s: %w", payload.Name, result.err)
	}
	t.mu.Lock()
	killed := current.stopped
	t.mu.Unlock()
	exit := Exit{Code: result.code}
	if killed {
		exit.Stopped = "killed"
	}
	t.reply(Message{ID: message.ID, Kind: KindEnd, Exit: &exit.Code, Stopped: exit.Stopped})
	return nil
}

// kill stops one exec's process group. A target that has already finished is not an error: the
// client cannot know the command ended while its kill was in flight.
func (t *session) kill(target uint64) bool {
	t.mu.Lock()
	current, ok := t.execs[target]
	if ok {
		current.stopped = true
	}
	t.mu.Unlock()
	if !ok {
		return false
	}
	if err := current.handle.Kill(); err != nil {
		t.server.log("shim: killing exec %d: %v", target, err)
	}
	return true
}

func (t *session) killAll() {
	t.mu.Lock()
	execs := make([]*running, 0, len(t.execs))
	for _, current := range t.execs {
		current.stopped = true
		execs = append(execs, current)
	}
	t.mu.Unlock()
	for _, current := range execs {
		if err := current.handle.Kill(); err != nil {
			t.server.log("shim: killing %s's command: %v", current.name, err)
		}
	}
}

func copyOutput(reader io.ReadCloser, name string, id uint64, chunks chan<- Message) {
	defer reader.Close()
	buffer := make([]byte, 32*1024)
	for {
		count, err := reader.Read(buffer)
		if count > 0 {
			data := make([]byte, count)
			copy(data, buffer[:count])
			chunks <- Message{ID: id, Kind: KindChunk, Stream: name, Data: data}
		}
		if err != nil {
			return
		}
	}
}

func prepareTarget(rootfs string, bind Bind, owner, group int) error {
	target := filepath.Clean(strings.TrimPrefix(bind.Target, "/"))
	if target == "." || target == "" {
		return fmt.Errorf("shim: %s cannot be a mount target", bind.Target)
	}
	path := filepath.Join(rootfs, target)
	if bind.File {
		if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
			return err
		}
		file, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY, 0o644)
		if err != nil {
			return err
		}
		if err := file.Close(); err != nil {
			return err
		}
	} else if err := os.MkdirAll(path, 0o755); err != nil {
		return err
	}
	if owner > 0 {
		return chownTree(path, owner, group)
	}
	return nil
}

// chownTree gives a whole tree to one user. Link-aware: an OCI rootfs holds links to files that
// are not in it (broken man-page links, for one), and chowning through one of those is a failure
// that stops a container being made (measured).
func chownTree(path string, uid, gid int) error {
	return filepath.Walk(path, func(inner string, _ os.FileInfo, err error) error {
		if err != nil {
			return err
		}
		return os.Lchown(inner, uid, gid)
	})
}

func (t *session) fail(id uint64, err error) {
	t.reply(Message{ID: id, Kind: KindError, Error: err.Error()})
}

func (t *session) succeed(id uint64, result any) {
	payload, err := marshal(result)
	if err != nil {
		t.fail(id, err)
		return
	}
	t.reply(Message{ID: id, Kind: KindResult, Result: payload})
}

func (t *session) reply(message Message) {
	if err := t.writer.write(message); err != nil {
		t.server.log("shim: writing a reply failed: %v", err)
	}
}

func firstLine(text string) string {
	if before, _, ok := strings.Cut(text, "\n"); ok {
		return before
	}
	return text
}

// syncWriter serializes replies: several requests are in flight at once, and two interleaved
// half-written lines are a protocol nobody can read.
type syncWriter struct {
	mu   sync.Mutex
	conn io.Writer
}

func (w *syncWriter) write(message Message) error {
	line, err := encode(message)
	if err != nil {
		return err
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	_, err = w.conn.Write(line)
	return err
}
