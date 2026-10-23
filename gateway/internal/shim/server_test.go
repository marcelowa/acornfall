package shim

import (
	"bytes"
	"context"
	"errors"
	"io"
	"net"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"
)

// fakeRuntime is the container runtime's command line, recorded: the shim's logic is about what
// it asks the runtime to do, and that is testable without a runtime, a kernel, or root.
type fakeRuntime struct {
	mu      sync.Mutex
	calls   [][]string
	answers map[string]string
	// failures is per command prefix, for the case a test is about: one container the runtime
	// cannot answer for, while every other command works.
	failures map[string]error
	failure  error
	handle   *fakeHandle
}

func (f *fakeRuntime) Run(_ context.Context, args ...string) (string, error) {
	f.record(args)
	// A configured failure comes first: a fake that answers anyway is a fake that hides the case
	// the test was written for.
	if f.failure != nil {
		return "", f.failure
	}
	key := strings.Join(args, " ")
	for prefix, err := range f.failures {
		if strings.HasPrefix(key, prefix) {
			return "", err
		}
	}
	for prefix, answer := range f.answers {
		if strings.HasPrefix(key, prefix) {
			return answer, nil
		}
	}
	return "", nil
}

func (f *fakeRuntime) Start(_ context.Context, args ...string) (Handle, error) {
	f.record(args)
	if f.failure != nil {
		return nil, f.failure
	}
	if f.handle == nil {
		f.handle = newFakeHandle()
	}
	return f.handle, nil
}

func (f *fakeRuntime) record(args []string) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.calls = append(f.calls, args)
}

func (f *fakeRuntime) ran(prefix string) []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	for _, call := range f.calls {
		if strings.HasPrefix(strings.Join(call, " "), prefix) {
			return call
		}
	}
	return nil
}

func (f *fakeRuntime) all() string {
	f.mu.Lock()
	defer f.mu.Unlock()
	var lines []string
	for _, call := range f.calls {
		lines = append(lines, strings.Join(call, " "))
	}
	return strings.Join(lines, "\n")
}

// fakeHandle is a running command: two streams the test writes, and a kill the test can see.
type fakeHandle struct {
	outReader *io.PipeReader
	outWriter *io.PipeWriter
	errReader *io.PipeReader
	errWriter *io.PipeWriter
	code      chan int
	killed    chan struct{}
	once      sync.Once
}

func newFakeHandle() *fakeHandle {
	outReader, outWriter := io.Pipe()
	errReader, errWriter := io.Pipe()
	return &fakeHandle{
		outReader: outReader, outWriter: outWriter,
		errReader: errReader, errWriter: errWriter,
		code:   make(chan int, 1),
		killed: make(chan struct{}, 1),
	}
}

func (h *fakeHandle) Stdout() io.ReadCloser { return h.outReader }
func (h *fakeHandle) Stderr() io.ReadCloser { return h.errReader }

func (h *fakeHandle) Kill() error {
	h.once.Do(func() {
		h.killed <- struct{}{}
		h.outWriter.Close()
		h.errWriter.Close()
		h.code <- 137
	})
	return nil
}

func (h *fakeHandle) Wait() (int, error) { return <-h.code, nil }

// finish is what a command does when it ends by itself.
func (h *fakeHandle) finish(code int) {
	h.once.Do(func() {
		h.outWriter.Close()
		h.errWriter.Close()
		h.code <- code
	})
}

func (h *fakeHandle) wasKilled() bool {
	select {
	case <-h.killed:
		return true
	default:
		return false
	}
}

// connected starts a server on one end of a pipe and a client on the other: the real protocol,
// with the runtime faked.
func connected(t *testing.T, runtime Runner) (*Client, *Server) {
	t.Helper()
	server := &Server{Version: "v0.0.0-test", Runner: runtime, Log: t.Logf}
	client, shim := net.Pipe()
	go func() {
		if err := server.Serve(shim); err != nil {
			t.Logf("serve: %v", err)
		}
	}()
	return NewClient(client), server
}

func callContext(t *testing.T) (context.Context, context.CancelFunc) {
	t.Helper()
	return context.WithTimeout(context.Background(), 10*time.Second)
}

func TestTheShimAnswersTheHandshake(t *testing.T) {
	runtime := &fakeRuntime{answers: map[string]string{"lxc-start --version": "6.0.4"}}
	client, _ := connected(t, runtime)
	defer client.Close()
	ctx, cancel := callContext(t)
	defer cancel()
	hello, err := client.Hello(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if hello.Protocol != Protocol {
		t.Errorf("protocol = %d, want %d", hello.Protocol, Protocol)
	}
	if hello.Version != "v0.0.0-test" {
		t.Errorf("version = %q", hello.Version)
	}
	if hello.Runtime != "6.0.4" {
		t.Errorf("runtime = %q: the handshake reports what the machine has", hello.Runtime)
	}
}

// A machine without the runtime answers with nothing for it, which is how a gateway refuses with
// a sentence instead of failing on the first container.
func TestTheHandshakeSaysWhenTheMachineHasNoRuntime(t *testing.T) {
	client, _ := connected(t, &fakeRuntime{failure: errors.New("lxc-start: not found")})
	defer client.Close()
	ctx, cancel := callContext(t)
	defer cancel()
	hello, err := client.Hello(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if hello.Runtime != "" {
		t.Errorf("runtime = %q, want nothing", hello.Runtime)
	}
}

func TestTheShimListsWhatTheRuntimeKnows(t *testing.T) {
	runtime := &fakeRuntime{answers: map[string]string{
		"lxc-ls -1":                    "acornfall-one\nacornfall-two",
		"lxc-info -n acornfall-one -s": "State: RUNNING",
		"lxc-info -n acornfall-two -s": "State: STOPPED",
	}}
	client, _ := connected(t, runtime)
	defer client.Close()
	ctx, cancel := callContext(t)
	defer cancel()
	instances, err := client.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if len(instances) != 2 {
		t.Fatalf("instances = %v", instances)
	}
	if instances[0].Name != "acornfall-one" || !instances[0].Running {
		t.Errorf("first = %+v, want a running container", instances[0])
	}
	if instances[1].Running {
		t.Errorf("second = %+v, want a stopped container", instances[1])
	}
}

// A container that is there and cannot be read is reported as such. Failing the whole call is
// what turned one bad container into "this workspace has no sandbox" for every workspace on the
// machine, while their own containers were RUNNING.
func TestOneUnreadableContainerDoesNotFailTheList(t *testing.T) {
	runtime := &fakeRuntime{
		answers: map[string]string{
			"lxc-ls -1":                     "acornfall-good\nacornfall-bad",
			"lxc-info -n acornfall-good -s": "State: RUNNING",
		},
		failures: map[string]error{
			"lxc-info -n acornfall-bad -s": errors.New("container has no configuration file"),
		},
	}
	client, _ := connected(t, runtime)
	defer client.Close()
	ctx, cancel := callContext(t)
	defer cancel()

	instances, err := client.List(ctx)
	if err != nil {
		t.Fatalf("one unreadable container should not fail the list: %v", err)
	}
	if len(instances) != 2 {
		t.Fatalf("instances = %+v, want both containers", instances)
	}
	if instances[0].Name != "acornfall-good" || !instances[0].Running || instances[0].Problem != "" {
		t.Errorf("the container that answered should be running and unremarkable: %+v", instances[0])
	}
	if instances[1].Problem == "" {
		t.Errorf("the container that could not be read should say so: %+v", instances[1])
	}
	if instances[1].Running {
		t.Errorf("a container whose state is unknown is not running: %+v", instances[1])
	}
}

// The container's configuration is the gateway's (it renders the policy), and the shim is the
// hands: the image becomes the rootfs, the config is written, and every mount target the runtime
// would silently skip is created first.
func TestTheShimMakesAContainerFromTheWorkspacesImage(t *testing.T) {
	runtime := &fakeRuntime{}
	client, _ := connected(t, runtime)
	defer client.Close()
	dir := t.TempDir()
	rootfs := filepath.Join(dir, "rootfs")
	if err := os.MkdirAll(rootfs, 0o755); err != nil {
		t.Fatal(err)
	}
	ctx, cancel := callContext(t)
	defer cancel()
	err := client.Create(ctx, CreatePayload{
		Name:   "acornfall-app-1234abcd",
		Image:  "debian:stable-slim",
		Dir:    dir,
		Config: "lxc.uts.name = acornfall-app-1234abcd\n",
		Binds: []Bind{
			{Source: "/home/me/work", Target: "/home/me/work"},
			{Source: "/home/me/.acornfall/config.json", Target: "/home/me/.acornfall/config.json", File: true},
		},
	})
	if err != nil {
		t.Fatal(err)
	}
	create := runtime.ran("lxc-create")
	if create == nil {
		t.Fatalf("no create call: %s", runtime.all())
	}
	if strings.Join(create, " ") != "lxc-create -n acornfall-app-1234abcd -t oci -- -u docker://debian:stable-slim" {
		t.Errorf("create = %v", create)
	}
	config, err := os.ReadFile(filepath.Join(dir, "config"))
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(string(config), "lxc.uts.name") {
		t.Errorf("the gateway's configuration should be written, got %q", config)
	}
	if _, err := os.Stat(filepath.Join(rootfs, "home/me/work")); err != nil {
		t.Errorf("a bind's target is created before the container starts: %v", err)
	}
	if info, err := os.Stat(filepath.Join(rootfs, "home/me/.acornfall/config.json")); err != nil || info.IsDir() {
		t.Errorf("a file bind needs a file: %v", err)
	}
}

func TestTheShimRefusesAContainerThatExists(t *testing.T) {
	runtime := &fakeRuntime{answers: map[string]string{"lxc-ls -1": "acornfall-app-1234abcd"}}
	client, _ := connected(t, runtime)
	defer client.Close()
	ctx, cancel := callContext(t)
	defer cancel()
	err := client.Create(ctx, CreatePayload{Name: "acornfall-app-1234abcd", Image: "debian:stable-slim", Dir: t.TempDir(), Config: "x"})
	if err == nil || !strings.Contains(err.Error(), "already exists") {
		t.Fatalf("want a refusal, got %v", err)
	}
	if runtime.ran("lxc-create") != nil {
		t.Error("nothing should be created over an existing container")
	}
}

// A container the runtime says is not running after start is a container whose image has no
// init: saying "started" would be a lie the first command would find out.
func TestTheShimRefusesAContainerThatDoesNotStayUp(t *testing.T) {
	runtime := &fakeRuntime{answers: map[string]string{"lxc-info -n acornfall-x -s": "State: STOPPED"}}
	client, _ := connected(t, runtime)
	defer client.Close()
	ctx, cancel := callContext(t)
	defer cancel()
	err := client.Start(ctx, "acornfall-x")
	if err == nil || !strings.Contains(err.Error(), "stays alive") {
		t.Fatalf("want a refusal naming the init, got %v", err)
	}
}

func TestTheShimRunsACommandAndReportsItsOutput(t *testing.T) {
	runtime := &fakeRuntime{answers: map[string]string{"lxc-info -n acornfall-x -s": "State: RUNNING"}}
	handle := newFakeHandle()
	runtime.handle = handle
	client, _ := connected(t, runtime)
	defer client.Close()
	go func() {
		handle.outWriter.Write([]byte("hello\n"))
		handle.errWriter.Write([]byte("careful\n"))
		handle.finish(0)
	}()
	ctx, cancel := callContext(t)
	defer cancel()
	var out, errOut strings.Builder
	exit, err := client.Exec(ctx, ExecPayload{
		Name: "acornfall-x",
		Argv: []string{"sh", "-c", "echo hello"},
		Cwd:  "/home/me/work",
		Env:  []string{"HOME=/root"},
		UID:  1000,
		GID:  1000,
	}, func(stream string, data []byte) {
		if stream == "stdout" {
			out.Write(data)
		} else {
			errOut.Write(data)
		}
	})
	if err != nil {
		t.Fatal(err)
	}
	if exit.Code != 0 || exit.Stopped != "" {
		t.Errorf("exit = %+v, want a clean finish", exit)
	}
	if out.String() != "hello\n" {
		t.Errorf("stdout = %q", out.String())
	}
	if errOut.String() != "careful\n" {
		t.Errorf("stderr = %q", errOut.String())
	}
	args := strings.Join(runtime.ran("lxc-attach"), " ")
	for _, want := range []string{
		"-n acornfall-x",
		"--clear-env",
		"-v PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin",
		"-v HOME=/root",
		"-u 1000",
		"-g 1000",
		`sh -c cd "$1" || exit 1; shift; exec "$@" sh /home/me/work`,
		"sh -c echo hello",
	} {
		if !strings.Contains(args, want) {
			t.Errorf("attach should carry %q, got %q", want, args)
		}
	}
}

// The point of the shim: a cancelled call kills the command inside the container, and the report
// says it was stopped rather than inventing an exit code. The fake's handle is the process
// group: the kill has to reach it.
func TestKillingAnExecStopsWhatRunsInside(t *testing.T) {
	runtime := &fakeRuntime{answers: map[string]string{"lxc-info -n acornfall-x -s": "State: RUNNING"}}
	handle := newFakeHandle()
	runtime.handle = handle
	client, _ := connected(t, runtime)
	defer client.Close()
	ctx, cancel := context.WithCancel(context.Background())
	go func() {
		time.Sleep(20 * time.Millisecond)
		handle.outWriter.Write([]byte("still here\n"))
	}()
	done := make(chan struct{})
	var exit Exit
	var err error
	go func() {
		defer close(done)
		exit, err = client.Exec(ctx, ExecPayload{Name: "acornfall-x", Argv: []string{"sleep", "300"}}, nil)
	}()
	time.Sleep(100 * time.Millisecond)
	cancel()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("the killed exec never returned")
	}
	if err != nil {
		t.Fatalf("a stopped command is a result, not an error: %v", err)
	}
	if exit.Stopped != "killed" {
		t.Errorf("exit = %+v, want it stopped", exit)
	}
	if !handle.wasKilled() {
		t.Error("the kill has to reach the command inside the container, not only the attach")
	}
}

// A kill that arrives after the command finished is not an error: the client cannot know.
func TestAKillForAFinishedCommandIsNotAnError(t *testing.T) {
	runtime := &fakeRuntime{}
	client, _ := connected(t, runtime)
	defer client.Close()
	ctx, cancel := callContext(t)
	defer cancel()
	var result KillResult
	if err := call(client, ctx, OpKill, KillPayload{Target: 42}, &result); err != nil {
		t.Fatal(err)
	}
	if result.Killed {
		t.Error("nothing was running, so nothing was killed")
	}
}

func TestTheShimRefusesAnOpItDoesNotKnow(t *testing.T) {
	client, _ := connected(t, &fakeRuntime{})
	defer client.Close()
	ctx, cancel := callContext(t)
	defer cancel()
	err := call[NamePayload](client, ctx, "fly", nil, nil)
	if err == nil || !strings.Contains(err.Error(), "unknown op") {
		t.Fatalf("want a refusal naming the op, got %v", err)
	}
}

// An exec in a container that is not running is refused by name: attaching to a stopped
// container is a hang or a mystery, depending on the runtime's mood.
func TestTheShimRefusesAnExecInAStoppedContainer(t *testing.T) {
	runtime := &fakeRuntime{answers: map[string]string{"lxc-info -n acornfall-x -s": "State: STOPPED"}}
	client, _ := connected(t, runtime)
	defer client.Close()
	ctx, cancel := callContext(t)
	defer cancel()
	_, err := client.Exec(ctx, ExecPayload{Name: "acornfall-x", Argv: []string{"true"}}, nil)
	if err == nil || !strings.Contains(err.Error(), "not running") {
		t.Fatalf("want a refusal naming the state, got %v", err)
	}
}

// Across the wire, a protocol nobody speaks is refused at the handshake: everything after it
// would be read wrong.
func TestTheClientRefusesAProtocolItDoesNotSpeak(t *testing.T) {
	client, shim := net.Pipe()
	defer client.Close()
	defer shim.Close()
	go func() {
		buffer := make([]byte, 4096)
		_, err := shim.Read(buffer)
		if err != nil {
			return
		}
		payload, _ := marshal(Hello{Protocol: Protocol + 1, Version: "from the future"})
		line, _ := encode(Message{ID: 1, Kind: KindResult, Result: payload})
		shim.Write(line)
	}()
	ctx, cancel := callContext(t)
	defer cancel()
	if _, err := NewClient(client).Hello(ctx); err == nil || !strings.Contains(err.Error(), "protocol") {
		t.Fatalf("want a refusal naming the protocol, got %v", err)
	}
}

// Removing a container that is still running is a thing the product asks for (a workspace
// forgotten while its tools work), and the runtime refuses to destroy a running container:
// measured, the destroy fails with "is running" and the workspace stays behind.
func TestRemovingAWorkspaceStopsItFirst(t *testing.T) {
	runtime := &fakeRuntime{answers: map[string]string{"lxc-info -n acornfall-x -s": "State: RUNNING"}}
	client, _ := connected(t, runtime)
	defer client.Close()
	ctx, cancel := callContext(t)
	defer cancel()
	if err := client.Remove(ctx, "acornfall-x"); err != nil {
		t.Fatal(err)
	}
	calls := runtime.all()
	stop := strings.Index(calls, "lxc-stop -n acornfall-x -k")
	destroy := strings.Index(calls, "lxc-destroy -f -n acornfall-x")
	if stop < 0 || destroy < 0 || stop > destroy {
		t.Errorf("the kill has to come before the destroy, got:\n%s", calls)
	}
}

// A create that was cut short leaves a rootfs.tmp the runtime cannot remove on virtiofs: it
// asks the filesystem for flags and gets ENOTTY. The container never ran, so its folder is
// removed directly. Measured on the appliance, beta.33: new-03 said "this workspace has no
// sandbox" for ever while the leftover sat in /var/lib/lxc.
func TestAHalfMadeContainerIsRemovedWhenTheRuntimeCannot(t *testing.T) {
	dir := filepath.Join(t.TempDir(), "acornfall-x")
	if err := os.MkdirAll(filepath.Join(dir, "rootfs.tmp", "rootfs", "usr", "share"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "rootfs.tmp", "rootfs", "usr", "share", "Debconf"), []byte("x"), 0o644); err != nil {
		t.Fatal(err)
	}
	runtime := &fakeRuntime{
		answers: map[string]string{
			"lxc-info -n acornfall-x -s":                 "State: STOPPED",
			"lxc-info -n acornfall-x -c lxc.rootfs.path": "lxc.rootfs.path = " + filepath.Join(dir, "rootfs"),
		},
		failures: map[string]error{
			"lxc-destroy": errors.New("lxc-destroy: _recursive_rmdir: 162 Inappropriate ioctl for device - Failed to delete " + filepath.Join(dir, "rootfs.tmp", "rootfs", "usr", "share", "Debconf")),
		},
	}
	client, _ := connected(t, runtime)
	defer client.Close()
	ctx, cancel := callContext(t)
	defer cancel()
	if err := client.Remove(ctx, "acornfall-x"); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(dir); !os.IsNotExist(err) {
		t.Fatalf("the leftover folder should be gone, stat err = %v", err)
	}
	if !strings.Contains(runtime.all(), "lxc-info -n acornfall-x -c lxc.rootfs.path") {
		t.Errorf("the runtime should be asked for the folder it refused, calls:\n%s", runtime.all())
	}
}

// bufferConn is a connection made of a reader and a buffer: what `shim --stdio` is, and the
// shortest way to ask whether a pipe of calls is answered.
type bufferConn struct {
	reader io.Reader
	buffer *bytes.Buffer
}

func (c *bufferConn) Read(data []byte) (int, error)  { return c.reader.Read(data) }
func (c *bufferConn) Write(data []byte) (int, error) { return c.buffer.Write(data) }
func (c *bufferConn) Close() error                   { return nil }

// A connection that carries calls and then ends is a client that wants answers: replies must not
// be dropped because the write side ended first.
func TestCallsAreAnsweredBeforeTheConnectionEnds(t *testing.T) {
	server := &Server{Version: "v0.0.0-test", Runner: &fakeRuntime{}, Log: t.Logf}
	conn := &bufferConn{
		reader: strings.NewReader(`{"id":1,"op":"hello"}` + "\n" + `{"id":2,"op":"list"}` + "\n" + `{"id":3,"op":"fly"}` + "\n"),
		buffer: &bytes.Buffer{},
	}
	if err := server.Serve(conn); err != nil {
		t.Fatal(err)
	}
	kinds := map[uint64]string{}
	for line := range strings.SplitSeq(strings.TrimSpace(conn.buffer.String()), "\n") {
		var message Message
		if err := unmarshal([]byte(line), &message); err != nil {
			t.Fatalf("a reply that is not a message: %q", line)
		}
		kinds[message.ID] = message.Kind
	}
	if len(kinds) != 3 {
		t.Fatalf("replies = %v, want all three", kinds)
	}
	if kinds[3] != KindError {
		t.Errorf("an unknown op is refused, got %v", kinds)
	}
}

// Stopping or removing what is already gone is the wanted state, not a failure: the runtime says
// "is not running" and "is not defined", and a caller cannot tell those from a real error.
func TestStoppingOrRemovingWhatIsGoneIsNotAFailure(t *testing.T) {
	runtime := &fakeRuntime{answers: map[string]string{
		"lxc-stop -n acornfall-x -k":    "",
		"lxc-destroy -f -n acornfall-x": "",
		"lxc-start --version":           "6.0.4",
	}}
	runtime.failure = errors.New("lxc-stop: acornfall-x: permission denied")
	client, _ := connected(t, runtime)
	defer client.Close()
	ctx, cancel := callContext(t)
	defer cancel()
	if err := client.Stop(ctx, "acornfall-x"); err == nil {
		t.Error("a stop the runtime refuses for another reason is a failure")
	}
	runtime.failure = errors.New("lxc-stop: acornfall-x: is not running")
	if err := client.Stop(ctx, "acornfall-x"); err != nil {
		t.Errorf("a container that is not running is already stopped: %v", err)
	}
	runtime.failure = errors.New("lxc-destroy: acornfall-x: Container is not defined")
	if err := client.Remove(ctx, "acornfall-x"); err != nil {
		t.Errorf("a container that is not there is already removed: %v", err)
	}
}

// A mount can exist and still be unreachable: the target is chowned to the tool's user, but the
// image's /root (or a user's home) is 700 and owned by the container's root. The tool runs as the
// share owner, not as root, so it cannot reach a workspace mounted under that path. The parent
// chain gets execute permission and nothing else.
func TestAParentOfAMountIsTraversableForItsOwner(t *testing.T) {
	rootfs := t.TempDir()
	home := filepath.Join(rootfs, "root")
	if err := os.MkdirAll(home, 0o700); err != nil {
		t.Fatal(err)
	}
	ownerID := os.Getuid()
	if ownerID == 0 {
		ownerID = 12345
	}
	target := Bind{Target: "/root/acornfall/workspaces/w"}
	if err := prepareTarget(rootfs, target, ownerID, ownerID); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(home)
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm()&0o111 != 0o111 {
		t.Errorf("the parent should be traversable by the tool's user, mode %o", info.Mode().Perm())
	}
	if info.Mode().Perm()&0o044 != 0 {
		t.Errorf("execute is enough; the parent should not gain group or other read, mode %o", info.Mode().Perm())
	}
	leaf := filepath.Join(rootfs, "root", "acornfall", "workspaces", "w")
	leafInfo, err := os.Stat(leaf)
	if err != nil {
		t.Fatal(err)
	}
	if leafInfo.Mode().Perm()&0o111 != 0o111 {
		t.Errorf("a directory the tool must enter should be traversable, mode %o", leafInfo.Mode().Perm())
	}
}
