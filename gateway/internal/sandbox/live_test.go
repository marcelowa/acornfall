package sandbox

import (
	"bufio"
	"context"

	"encoding/json"
	"errors"
	"fmt"
	"github.com/acornfall/acornfall/gateway/internal/update"
	"io"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"
)

// liveDriver is the real engine, with its state directory shared when the environment names
// one. A fresh directory per run means a fresh pull of the image every run, which is how a
// suite meets a registry's anonymous rate limit; the shared directory is also what the e2e
// suite's image cache is.
func liveDriver(home string) *Microsandbox {
	driver := NewMicrosandbox(home)
	if state := os.Getenv("ACORNFALL_SANDBOX_STATE"); state != "" {
		driver = driver.WithStateDir(state)
	}
	return driver
}

// Live: only where a hypervisor exists. Proves the CLI shapes against the real engine.
func TestLiveProduceAndStop(t *testing.T) {
	if os.Getenv("ACORNFALL_LIVE_SANDBOX") == "" {
		t.Skip("set ACORNFALL_LIVE_SANDBOX=1 to boot a real sandbox")
	}
	home := t.TempDir()
	ws := filepath.Join(home, "work")
	if err := os.MkdirAll(ws, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(ws, "hello.txt"), []byte("from the host\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	manager, err := Open(context.Background(), Options{Machinery: home, Driver: liveDriver(home), Log: t.Logf})
	if err != nil {
		t.Fatal(err)
	}
	if problem := manager.Problem(); problem != nil {
		t.Fatalf("no sandbox on this machine: %v", problem)
	}
	name, err := manager.Produce(context.Background(), Policy{Workspace: ws, Image: "debian:stable-slim", Egress: true}, filepath.Join(home, "state"))
	if err != nil {
		t.Fatal(err)
	}
	t.Logf("sandbox %s", name)
	status, err := manager.Status(context.Background(), ws)
	if err != nil || status == "" {
		t.Fatalf("status %q err %v", status, err)
	}
	if err := manager.Stop(context.Background(), ws); err != nil {
		t.Fatal(err)
	}
	if err := manager.Remove(context.Background(), ws); err != nil {
		t.Fatal(err)
	}
}

// Live: the machine half of ADR 0021, against the real engine. The per-workspace driver never
// had to do this: create one VM for the install, and leave it alone the second time. What lives
// inside it — the containers — arrives with the transport for LXC.
func TestLiveTheMachineIsCreatedOnceAndBootedAgain(t *testing.T) {
	if os.Getenv("ACORNFALL_LIVE_SANDBOX") == "" {
		t.Skip("set ACORNFALL_LIVE_SANDBOX=1 to boot a real machine")
	}
	home := t.TempDir()
	driver := liveDriver(home)
	ctx := context.Background()
	if err := driver.Install(ctx, t.Logf); err != nil {
		t.Fatal(err)
	}
	if err := driver.Usable(); err != nil {
		t.Skipf("no sandbox on this machine: %v", err)
	}
	machine := NewMachineEngine(driver, Machine{
		CPUs:   2,
		Memory: "1G",
		Disk:   "flat:1G",
	}, filepath.Join(home, "state"))
	defer func() {
		if err := machine.RemoveMachine(ctx); err != nil {
			t.Errorf("removing the machine: %v", err)
		}
	}()
	if err := machine.EnsureMachine(ctx); err != nil {
		// A /dev/kvm that exists but cannot be used (a nested or restricted runner) says so only
		// here: this host cannot boot a machine, which is its limit, not the product's.
		t.Skipf("this machine cannot be booted here: %v", err)
	}
	name := machine.Name()
	status := func() string {
		t.Helper()
		instances, err := driver.List(ctx)
		if err != nil {
			t.Fatal(err)
		}
		count := 0
		found := ""
		for _, instance := range instances {
			if instance.Name == name {
				count++
				found = instance.Status
			}
		}
		if count != 1 {
			t.Fatalf("want exactly one machine named %s, got %d", name, count)
		}
		return found
	}
	if got := status(); !strings.EqualFold(got, "running") {
		t.Fatalf("the machine should be running, got %q", got)
	}
	// Asking again, with the machine up, creates nothing and starts nothing.
	if err := machine.EnsureMachine(ctx); err != nil {
		t.Fatal(err)
	}
	if got := status(); !strings.EqualFold(got, "running") {
		t.Fatalf("the machine should still be running, got %q", got)
	}
	// A stopped machine is booted again, and it is the same machine: one instance, not two.
	if err := driver.Stop(ctx, name); err != nil {
		t.Fatal(err)
	}
	if got := status(); strings.EqualFold(got, "running") {
		t.Fatalf("the machine should be stopped, got %q", got)
	}
	if err := machine.EnsureMachine(ctx); err != nil {
		t.Fatal(err)
	}
	if got := status(); !strings.EqualFold(got, "running") {
		t.Fatalf("the stopped machine should be running again, got %q", got)
	}
}

// Live: the engine of ADR 0021, whole — a machine made by the pinned engine, the shim delivered
// into it over the door, and a workspace's container made, started, listed, stopped and removed
// through the driver. This is the test that says the pieces fit; the shim's own live test says
// what a container does once it exists.
//
//	ACORNFALL_LXC=1 go test ./internal/sandbox -run LiveLXC -v
func TestLiveLXCTheEngineMakesAContainer(t *testing.T) {
	if os.Getenv("ACORNFALL_LXC") == "" {
		t.Skip("set ACORNFALL_LXC=1 to drive a real container runtime")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	// A short machinery: the engine.s sockets live under its store, and a test.s own long name is a
	// refusal the engine makes on purpose (statePathLimit).
	home := shortTempDir(t)
	engine := NewMicrosandbox(home)
	if state := os.Getenv("ACORNFALL_SANDBOX_STATE"); state != "" {
		engine = engine.WithStateDir(state)
	}
	if err := engine.Install(ctx, t.Logf); err != nil {
		t.Fatal(err)
	}
	if err := engine.Usable(); err != nil {
		t.Skipf("no hypervisor here: %v", err)
	}
	// The machine runs the shim from the gateway's own binary, so the test builds one: the test
	// binary is not the command that has the shim subcommand.
	binary := filepath.Join(t.TempDir(), "acornfall")
	build := exec.CommandContext(ctx, "go", "build", "-o", binary, "./cmd/acornfall")
	build.Dir = "../.."
	if out, err := build.CombinedOutput(); err != nil {
		t.Fatalf("building the binary the machine runs the shim from: %v\n%s", err, out)
	}
	// The share: a folder of the user's, owned by them and traversable, which is what a
	// container's bind needs to work at all.
	share := filepath.Join("/var/tmp", "acornfall-live-share")
	if err := os.RemoveAll(share); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(share, 0o755); err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(share)
	workspace := filepath.Join(share, "work")
	if err := os.MkdirAll(workspace, 0o755); err != nil {
		t.Fatal(err)
	}
	// The machine's image has to carry the container runtime, and the appliance image that will is
	// not built yet. Installing it through the engine's exec is the one thing that exec is bad at
	// (ADR 0012: the CLI is for lifecycle, the SDK for execution) — measured here, a long install
	// loses its session and leaves dpkg interrupted — so what this test checks is the chain up to
	// the runtime, and the rest runs when the image exists (or when ACORNFALL_MACHINE_IMAGE names
	// one that carries it). The container's own life is the shim's live test, against a real
	// runtime.
	image := os.Getenv("ACORNFALL_MACHINE_IMAGE")
	// No flat root disk here: the machine shares this guest's disk, and a preallocated gigabyte
	// is more than it has. A real install wants the flat disk (machine.go), and that flag is
	// unit-tested; what this test is for is the chain.
	driver := NewLXC(engine, Machine{
		Image:  image,
		CPUs:   2,
		Memory: "1G",
		Share:  share,
	}, filepath.Join(home, "state", "machine.sock"), binary).WithLog(t.Logf)
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		if err := driver.Remove(cleanup, Name(workspace)); err != nil {
			t.Logf("removing the container: %v", err)
		}
		if err := driver.machine.RemoveMachine(cleanup); err != nil {
			t.Logf("removing the machine: %v", err)
		}
	}()
	if err := driver.EnsureMachine(ctx); err != nil {
		// A machine that cannot be created here is this host's limit, not the product's: a /dev/kvm
		// that exists but cannot be used (a nested or restricted runner) says so only at creation.
		t.Skipf("this machine cannot be booted here: %v", err)
	}
	// What the shim says when it cannot reach the door is the only account of why: dump it.
	defer func() {
		show, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()
		out := exec.CommandContext(show, engine.binary(), "exec", driver.machine.Name(), "--", "cat", "/var/log/acornfall-shim.log")
		out.Env = append(os.Environ(), engine.Env()...)
		if text, err := out.CombinedOutput(); err == nil {
			t.Logf("the shim's log inside the machine:\n%s", text)
		}
	}()
	// The chain, all of it: the machine is made, the shim is delivered into it, the door connects,
	// and the handshake answers. A machine whose image has no runtime answers that too, which is
	// where this stops until the appliance image exists.
	if _, err := driver.List(ctx); err != nil {
		if errors.Is(err, ErrUnavailable) {
			t.Skipf("the machine's image has no container runtime yet: %v", err)
		}
		t.Fatal(err)
	}
	policy := Policy{Workspace: workspace, Image: "debian:stable-slim", CPUs: 1, Memory: "512M"}
	name := Name(workspace)
	if err := driver.Create(ctx, policy, t.TempDir()); err != nil {
		t.Fatal(err)
	}
	instances, err := driver.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, instance := range instances {
		if instance.Name == name {
			found = true
			if instance.Running() {
				t.Errorf("%s should not be running before it is started", name)
			}
		}
	}
	if !found {
		t.Fatalf("%s is not among %v", name, instances)
	}
	if err := driver.Start(ctx, name); err != nil {
		t.Fatal(err)
	}
	manager := &Manager{driver: driver, machinery: home}
	status, err := manager.Status(ctx, workspace)
	if err != nil {
		t.Fatal(err)
	}
	if status != "RUNNING" {
		t.Fatalf("status = %q, want the container running", status)
	}
	if err := driver.Stop(ctx, name); err != nil {
		t.Fatal(err)
	}
	if err := driver.Remove(ctx, name); err != nil {
		t.Fatal(err)
	}
}

// Live: the appliance, whole — the machine boots acornfall as its init, and the console answers
// on the host's forwarded port. This is ADR 0022's shape end to end: the gateway and the worker
// inside the machine, the host a launcher and one published port.
//
//	ACORNFALL_LXC=1 ACORNFALL_MACHINE_IMAGE=<unpacked appliance> go test ./internal/sandbox -run LiveAppliance -v
func TestLiveTheApplianceServesTheConsole(t *testing.T) {
	if os.Getenv("ACORNFALL_LXC") == "" || os.Getenv("ACORNFALL_MACHINE_IMAGE") == "" {
		t.Skip("set ACORNFALL_LXC=1 and ACORNFALL_MACHINE_IMAGE=<unpacked appliance> to boot the appliance")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()
	home := shortTempDir(t)
	engine := NewMicrosandbox(home)
	if state := os.Getenv("ACORNFALL_SANDBOX_STATE"); state != "" {
		engine = engine.WithStateDir(state)
	}
	if err := engine.Install(ctx, t.Logf); err != nil {
		t.Fatal(err)
	}
	if err := engine.Usable(); err != nil {
		t.Skipf("no hypervisor here: %v", err)
	}
	// The root the machine mounts, and a workspace inside it: the appliance's containers bind
	// from the root, so a workspace outside it is one the appliance cannot see (ADR 0022).
	// It has to be on a filesystem the engine can bind into the microVM. A directory on a
	// virtiofs mount is not one: the machine boots, dies at once and its published port is
	// refused, with nothing in the engine.s output to say why. Real installs mount a home
	// directory; this is only ever a surprise inside a sandbox like this one.
	share := filepath.Join(t.TempDir(), "acornfall")
	workspace := filepath.Join(share, "workspaces", "general")
	if err := os.MkdirAll(workspace, 0o755); err != nil {
		t.Fatal(err)
	}
	// The image is the machine's rootfs, and the engine writes the containers it makes into it:
	// a run that leaves them behind gives the next run a machine with strangers in it. Cleaning
	// it here is a test saying so out loud — the engine's own answer is a proper overlay.
	if err := os.RemoveAll(filepath.Join(os.Getenv("ACORNFALL_MACHINE_IMAGE"), "var", "lib", "lxc")); err != nil {
		t.Logf("cleaning the image's containers: %v", err)
	}
	// A free port on the host, so two runs do not collide.
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	listener.Close()

	// The appliance's init: the product, whole. No shim line and no sandbox-state, because inside
	// the machine the containers are the gateway's own neighbours (--in-machine) — and the tier is
	// on: a workspace here gets a container, made and started in this machine. Everything it says
	// goes to a file inside the machine: the gateway's log is the only place a start that failed
	// explains itself, and the machine's console is not a place a person can read.
	// The one command this proof asks for: a tool in the second workspace. The file it writes is
	// read from the share afterwards, so the mount and the container are both proved. The
	// absolute path is the point: the bash tool has no promise about its working directory, and
	// a relative file landed in the container's rootfs instead of the workspace.
	second := filepath.Join(share, "workspaces", "second")
	script := filepath.Join(share, "dev-script.json")
	rules := fmt.Sprintf(`{"rules":[{"match":"prove the second workspace","tools":[{"name":"bash","args":{"command":"pwd; printf second > %s/tool-ran.txt; ls -ld %s; ls -l %s; hostname"}}],"reply":"the second workspace ran it"}]}`, second, second, second)
	if err := os.WriteFile(script, []byte(rules), 0o644); err != nil {
		t.Fatal(err)
	}
	start := strings.Join([]string{
		"ACORNFALL_DEV_SCRIPT=" + script + " exec /usr/local/bin/acornfall",
		"--addr 0.0.0.0:7777 --insecure",
		"--share " + share,
		"--machinery /var/lib/acornfall",
		"--workspace " + workspace,
		"--worker-dir /usr/local/lib/acornfall/worker",
		"--sandbox-engine lxc --in-machine",
		"--model faux/faux-1",
		">>/var/lib/acornfall/appliance.log 2>&1",
	}, " ")
	driver := NewLXC(engine, Machine{
		Image:  os.Getenv("ACORNFALL_MACHINE_IMAGE"),
		CPUs:   2,
		Memory: "1G",
		Share:  share,
	}, filepath.Join(home, "state", "machine.sock"), "/bin/true").WithLog(t.Logf)
	driver.machine.WithAppliance(start, fmt.Sprintf("127.0.0.1:%d:7777", port))
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		if err := driver.machine.RemoveMachine(cleanup); err != nil {
			t.Logf("removing the machine: %v", err)
		}
	}()
	if err := driver.EnsureMachine(ctx); err != nil {
		t.Fatal(err)
	}
	// The console, from the host, through the engine's own port forward.
	url := fmt.Sprintf("http://127.0.0.1:%d", port)
	// The container's image is pulled and unpacked inside the machine on the first workspace: on a cold
	// machine that is minutes, so the wait is generous rather than tight.
	deadline := time.Now().Add(12 * time.Minute)
	for {
		response, err := http.Get(url + "/api/state")
		if err == nil {
			body, _ := io.ReadAll(io.LimitReader(response.Body, 4096))
			response.Body.Close()
			if response.StatusCode == http.StatusOK {
				if !strings.Contains(string(body), "general") {
					t.Errorf("the appliance's console should know its workspace, got %s", body)
				}
				// The workspace's own container, running: control makes it when the workspace starts,
				// and the worker's first use of its engine is what starts it — so by the time the
				// console answers, the container should be up. Status comes from the runtime's own
				// `lxc-info`, and the manager only reports the container whose name matches this
				// workspace, so a stranger's container cannot answer for it.
				if strings.Contains(string(body), `"status":"RUNNING"`) {
					if !strings.Contains(string(body), `"engine":"lxc"`) {
						t.Errorf("a running container should be the machine's lxc, got %s", body)
					}
					t.Logf("the appliance answered on %s with a running container: %s", url, strings.TrimSpace(string(body))[:160])
					return
				}
			}
		}
		if time.Now().After(deadline) {
			t.Fatalf("the appliance never answered on %s: %v", url, err)
		}
		time.Sleep(3 * time.Second)
	}
}

// Live: a tool command goes through the worker and runs in the workspace's container. This is
// the one link the other tests cannot show — a hand start proves the container runs, and the
// container being RUNNING proves the worker reached its engine, but neither proves that a
// command the model asks for ends up inside the container rather than in the machine.
//
// The proof is the command's own output: LXC gives a container its name as its hostname, so
// `hostname` printing acornfall-general-<hash> is a command that ran inside the container. The
// dev provider is scripted to ask for exactly that (worker/src/devprovider.ts), and the script
// lives in the root — the mount — because the worker that reads it is inside the machine.
//
//	ACORNFALL_LXC=1 ACORNFALL_MACHINE_IMAGE=<unpacked appliance> go test ./internal/sandbox -run LiveATool -v
func TestLiveAToolRunsInTheContainer(t *testing.T) {
	if os.Getenv("ACORNFALL_LXC") == "" || os.Getenv("ACORNFALL_MACHINE_IMAGE") == "" {
		t.Skip("set ACORNFALL_LXC=1 and ACORNFALL_MACHINE_IMAGE=<unpacked appliance> to boot the appliance")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()
	home := shortTempDir(t)
	engine := NewMicrosandbox(home)
	if state := os.Getenv("ACORNFALL_SANDBOX_STATE"); state != "" {
		engine = engine.WithStateDir(state)
	}
	if err := engine.Install(ctx, t.Logf); err != nil {
		t.Fatal(err)
	}
	if err := engine.Usable(); err != nil {
		t.Skipf("no hypervisor here: %v", err)
	}
	share := filepath.Join(t.TempDir(), "acornfall")
	workspace := filepath.Join(share, "workspaces", "general")
	if err := os.MkdirAll(workspace, 0o755); err != nil {
		t.Fatal(err)
	}
	// The command the model will ask for, and where the worker finds it: in the mount, because
	// the worker is in the machine and the mount is the only folder both sides can see.
	script := filepath.Join(share, "dev-script.json")
	rules := `{"rules":[{"match":"prove it","tools":[{"name":"bash","args":{"command":"hostname"}}],"reply":"done"}]}`
	if err := os.WriteFile(script, []byte(rules), 0o644); err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	listener.Close()
	start := strings.Join([]string{
		"ACORNFALL_DEV_PROVIDER=1 ACORNFALL_DEV_SCRIPT=" + script + " exec /usr/local/bin/acornfall",
		"--addr 0.0.0.0:7777 --insecure",
		"--share " + share,
		"--machinery /var/lib/acornfall",
		"--workspace " + workspace,
		"--worker-dir /usr/local/lib/acornfall/worker",
		"--sandbox-engine lxc --in-machine",
		"--model faux/faux-1",
		">>/var/lib/acornfall/appliance.log 2>&1",
	}, " ")
	driver := NewLXC(engine, Machine{
		Image:  os.Getenv("ACORNFALL_MACHINE_IMAGE"),
		CPUs:   2,
		Memory: "1G",
		Share:  share,
	}, filepath.Join(home, "state", "machine.sock"), "/bin/true").WithLog(t.Logf)
	driver.machine.WithAppliance(start, fmt.Sprintf("127.0.0.1:%d:7777", port))
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		if err := driver.machine.RemoveMachine(cleanup); err != nil {
			t.Logf("removing the machine: %v", err)
		}
	})
	if err := driver.EnsureMachine(ctx); err != nil {
		t.Fatal(err)
	}
	url := fmt.Sprintf("http://127.0.0.1:%d", port)
	// The console, and the sandbox being ready, before a turn is worth asking for.
	deadline := time.Now().Add(12 * time.Minute)
	ready := false
	for !ready {
		response, err := http.Get(url + "/api/state")
		if err == nil {
			body, _ := io.ReadAll(io.LimitReader(response.Body, 8192))
			response.Body.Close()
			t.Logf("state: %.200s", body)
			ready = response.StatusCode == http.StatusOK && strings.Contains(string(body), `"status":"RUNNING"`)
		}
		if time.Now().After(deadline) {
			t.Fatalf("the appliance's container never came up on %s: %v", url, err)
		}
		time.Sleep(3 * time.Second)
	}
	// A conversation to ask in. The console makes one when asked for one.
	response, err := http.Post(url+"/api/workspaces/general/conversations", "application/json", strings.NewReader("{}"))
	if err != nil {
		t.Fatal(err)
	}
	var created struct {
		Conversation struct {
			ID string `json:"id"`
		} `json:"conversation"`
	}
	if err := json.NewDecoder(response.Body).Decode(&created); err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if created.Conversation.ID == "" {
		t.Fatal("the console made a conversation with no id")
	}
	conversation := created.Conversation.ID
	// The prompt, and then the transcript: the dev provider asks for `hostname` on this turn.
	response, err = http.Post(url+"/api/workspaces/general/conversations/"+conversation+"/messages",
		"application/json", strings.NewReader(`{"text":"prove it"}`))
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	// Accepted is the console saying the turn is queued, which is all a message can be: the
	// answer arrives on the transcript.
	if response.StatusCode != http.StatusOK && response.StatusCode != http.StatusAccepted {
		t.Fatalf("the console refused the message: %s", response.Status)
	}
	// The stream is the transcript, replayed and then live. Every frame's data is searched as it
	// arrives: what the command printed is what says where it ran.
	streamCtx, cancelStream := context.WithDeadline(ctx, time.Now().Add(6*time.Minute))
	defer cancelStream()
	request, err := http.NewRequestWithContext(streamCtx, http.MethodGet,
		fmt.Sprintf("%s/api/stream?workspace=general&conversation=%s", url, conversation), nil)
	if err != nil {
		t.Fatal(err)
	}
	stream, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("opening the transcript: %v", err)
	}
	defer stream.Body.Close()
	scanner := bufio.NewScanner(stream.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)
	transcript := &strings.Builder{}
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		transcript.WriteString(strings.TrimPrefix(line, "data: "))
		// The container's own name, as its hostname: the command ran in it, not in the machine.
		if strings.Contains(transcript.String(), "acornfall-general-") {
			t.Logf("a tool ran in the container: %s", firstMatch(transcript.String(), "acornfall-general-"))
			return
		}
	}
	t.Fatalf("no command ran in the container before the transcript closed")
}

// proveASecondWorkspaceRunsTools is the release gate's own journey: make a workspace after the
// first one, ask it for a tool, and read what the tool wrote. The first workspace is the one a
// fresh install has; every one after it is the case that broke repeatedly — a bridge address
// that already existed, a folder outside the mount, a half-made container. The console answering
// is not the same fact as a second workspace working, and only this asks the second one.
func proveASecondWorkspaceRunsTools(t *testing.T, ctx context.Context, url, share, image string) {
	t.Helper()
	// Create it. The console makes the folder and starts the workspace's harness and container
	// on the first read, which is why the wait below is a state read with a deadline.
	response, err := http.Post(url+"/api/workspaces", "application/json", strings.NewReader(`{"name":"second"}`))
	if err != nil {
		t.Fatalf("making the second workspace: %v", err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusOK && response.StatusCode != http.StatusCreated {
		t.Fatalf("the console refused the second workspace: %s", response.Status)
	}

	type stateView struct {
		Conversation *struct {
			ID string `json:"id"`
		} `json:"conversation"`
		Lifecycle struct {
			Phase  string `json:"phase"`
			Reason string `json:"reason"`
		} `json:"lifecycle"`
		WorkerError string `json:"workerError"`
		Sandbox     struct {
			Tools   bool   `json:"tools"`
			Status  string `json:"status"`
			Problem string `json:"problem"`
		} `json:"sandbox"`
	}
	deadline := time.Now().Add(12 * time.Minute)
	conversation := ""
	for conversation == "" {
		response, err := http.Get(url + "/api/workspaces/second/state")
		if err == nil {
			var view stateView
			decodeErr := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&view)
			response.Body.Close()
			if decodeErr == nil {
				if view.Lifecycle.Phase == "failed" {
					t.Fatalf("the second workspace failed before it answered: %s", view.Lifecycle.Reason)
				}
				if view.Conversation != nil {
					conversation = view.Conversation.ID
				}
				// A ready lifecycle with a sandbox that could not be made is a workspace whose
				// tools will refuse; say which problem now, not after a six-minute wait for a
				// command that cannot run. The gateway provisions the sandbox before the worker,
				// so this state is settled by the time the worker is ready.
				if view.Lifecycle.Phase == "ready" && !view.Sandbox.Tools && view.Sandbox.Problem != "" {
					t.Fatalf("the second workspace is ready but its sandbox is not: %s", view.Sandbox.Problem)
				}
				if view.Lifecycle.Phase == "ready" && view.Sandbox.Tools && view.Conversation != nil {
					t.Logf("second workspace ready: sandbox=%s tools=%v", view.Sandbox.Status, view.Sandbox.Tools)
					break
				}
			}
		}
		if time.Now().After(deadline) {
			t.Fatalf("the second workspace never became ready: %v", err)
		}
		time.Sleep(time.Second)
	}
	if conversation == "" {
		t.Fatal("the second workspace reported ready with no conversation")
	}

	// The source side of the prefix, before the turn: whether the engine made it at all, and what
	// is in it, is the first thing to know when the mount does not land. The runtime skips an
	// optional mount whose source is absent without a word, so this is the only place the absence
	// is visible.
	prefixSource := filepath.Join(share, "workspaces", "second", ".acornfall", "prefix", "usr")
	if entries, err := os.ReadDir(prefixSource); err == nil {
		t.Logf("prefix source exists before the turn: %s (%d entries)", prefixSource, len(entries))
	} else {
		t.Logf("prefix source is not there before the turn: %v", err)
	}

	response, err = http.Post(url+"/api/workspaces/second/conversations/"+conversation+"/messages",
		"application/json", strings.NewReader(`{"text":"prove the second workspace"}`))
	if err != nil {
		t.Fatal(err)
	}
	response.Body.Close()
	if response.StatusCode != http.StatusOK && response.StatusCode != http.StatusAccepted {
		t.Fatalf("the second workspace refused the message: %s", response.Status)
	}

	// The stream is the transcript, replayed and then live. The container names itself as the
	// command's hostname; the file it wrote is read from the share after the turn.
	// The runner pulls the container image and makes the rootfs on the first tool; that is
	// minutes on a cold runner, and the deadline must be the slowest machine, not the fastest.
	streamCtx, cancel := context.WithDeadline(ctx, time.Now().Add(12*time.Minute))
	defer cancel()
	request, err := http.NewRequestWithContext(streamCtx, http.MethodGet,
		fmt.Sprintf("%s/api/stream?workspace=second&conversation=%s", url, conversation), nil)
	if err != nil {
		t.Fatal(err)
	}
	stream, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatalf("opening the second workspace's transcript: %v", err)
	}
	defer stream.Body.Close()
	if stream.StatusCode != http.StatusOK {
		body, _ := io.ReadAll(io.LimitReader(stream.Body, 8<<10))
		t.Fatalf("the second workspace's stream answered %s: %s", stream.Status, strings.TrimSpace(string(body)))
	}
	scanner := bufio.NewScanner(stream.Body)
	scanner.Buffer(make([]byte, 0, 64*1024), 8*1024*1024)
	transcript := &strings.Builder{}
	for scanner.Scan() {
		line := scanner.Text()
		if !strings.HasPrefix(line, "data: ") {
			continue
		}
		transcript.WriteString(strings.TrimPrefix(line, "data: "))
		if strings.Contains(transcript.String(), "acornfall-second-") {
			t.Logf("a tool ran in the second workspace's container: %s", firstMatch(transcript.String(), "acornfall-second-"))
			if _, err := os.Stat(filepath.Join(share, "workspaces", "second", "tool-ran.txt")); err != nil {
				t.Fatalf("the tool ran, but its file is not in the second workspace's mount: %v\n--- transcript ---\n%s", err, transcript.String())
			}
			// The prefix, and the whole reason it exists: an unprivileged container installed a
			// tool into /usr/local and the bytes are in the workspace afterwards. Checking the
			// transcript instead would be checking the command that was asked for — it contains
			// the same words — so the assertion is the file, and the transcript's DIAG lines say
			// which way it failed when it does.
			installed := filepath.Join(share, "workspaces", "second", ".acornfall", "prefix", "usr", "bin", "proof")
			payload, readErr := os.ReadFile(installed)
			if readErr != nil {
				t.Fatalf("a tool wrote to /usr/local and nothing reached the workspace's prefix at %s: %v\n--- transcript ---\n%s", installed, readErr, transcript.String())
			}
			if !strings.Contains(string(payload), "from-the-prefix-bytes") {
				t.Fatalf("the file in the prefix is not the one the tool wrote: %q", payload)
			}
			// The two things every image was missing (acornfall#98), read from the share rather
			// than from the transcript: a command that echoes its own arguments would pass either
			// way. `id -un` is the passwd entry, and a non-empty bundle is the trust store.
			whoami, err := os.ReadFile(filepath.Join(share, "workspaces", "second", "whoami.txt"))
			if err != nil {
				t.Fatalf("the container could not name its own uid: %v", err)
			}
			if strings.TrimSpace(string(whoami)) != "acornfall" {
				t.Errorf("the uid the tools run as has no name in the container: %q", whoami)
			}
			roots, err := os.ReadFile(filepath.Join(share, "workspaces", "second", "roots.txt"))
			if err != nil {
				t.Fatalf("the container did not report its trust store: %v", err)
			}
			if strings.TrimSpace(string(roots)) != "present" {
				t.Errorf("the container has no certificate bundle, so its first https request fails on the CA: %q", roots)
			}
			// `~` is a folder of the workspace, not the repository (ADR 0035): a tool that writes its
			// own settings must not appear in somebody's `git status`.
			home, err := os.ReadFile(filepath.Join(share, "workspaces", "second", ".acornfall", "home", "home-proof.txt"))
			if err != nil {
				diag, _ := os.ReadFile(filepath.Join(share, "workspaces", "second", "diag.txt"))
				t.Fatalf("the container could not write to its home: %v\n--- what the container said ---\n%s", err, diag)
			}
			if strings.TrimSpace(string(home)) != "home-bytes" {
				t.Errorf("~ is not the workspace's own home folder: %q", home)
			}
			t.Logf("the workspace installed into its own prefix: %s", installed)
			return
		}
	}
	t.Fatalf("no tool ran in the second workspace before the transcript closed:\n%s\n--- appliance log ---\n%s", transcript.String(), applianceLogTail(image, 8<<10))
}

// applianceLogTail is the machine's own log, for the failure that only happens in a release: the
// test can read it because the image is a directory in the host's temp space.
func applianceLogTail(image string, limit int64) string {
	file, err := os.Open(filepath.Join(image, "var", "lib", "acornfall", "appliance.log"))
	if err != nil {
		return "no appliance log: " + err.Error()
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil {
		return "no appliance log size: " + err.Error()
	}
	offset := max(0, info.Size()-limit)
	if _, err := file.Seek(offset, io.SeekStart); err != nil {
		return "no appliance log seek: " + err.Error()
	}
	payload, err := io.ReadAll(io.LimitReader(file, limit))
	if err != nil {
		return "no appliance log read: " + err.Error()
	}
	return strings.TrimSpace(string(payload))
}

// firstMatch is the container's name as it appeared, for the log: the identifier and the
// characters after it, which is what a reader needs to see to believe it.
func firstMatch(text, prefix string) string {
	index := strings.Index(text, prefix)
	if index < 0 {
		return ""
	}
	rest := text[index:]
	if len(rest) > 48 {
		rest = rest[:48]
	}
	return rest
}

// Live: the appliance boots from the release's own tarball. Every other test here boots a
// directory, and releases ship a tarball — the two differ exactly in what tar carries: symlinks,
// hard links, device nodes. Two betas were broken that way, twice: an image with no shell, then
// an image with no /dev. This unpacks the shipped artifact with the code an install uses, and
// boots what comes out.
//
//	ACORNFALL_LXC=1 ACORNFALL_APPLIANCE_TARBALL=<appliance-linux-amd64.tar.gz> go test ./internal/sandbox -run LiveApplianceFromTheRelease
func TestLiveTheApplianceBootsFromItsReleaseTarball(t *testing.T) {
	archive := os.Getenv("ACORNFALL_APPLIANCE_TARBALL")
	if os.Getenv("ACORNFALL_LXC") == "" || archive == "" {
		t.Skip("set ACORNFALL_LXC=1 and ACORNFALL_APPLIANCE_TARBALL=<release tarball> to unpack and boot one")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Minute)
	defer cancel()
	home := shortTempDir(t)
	engine := NewMicrosandbox(home)
	if state := os.Getenv("ACORNFALL_SANDBOX_STATE"); state != "" {
		engine = engine.WithStateDir(state)
	}
	if err := engine.Install(ctx, t.Logf); err != nil {
		t.Fatal(err)
	}
	if err := engine.Usable(); err != nil {
		t.Skipf("no hypervisor here: %v", err)
	}
	payload, err := os.ReadFile(archive)
	if err != nil {
		t.Fatal(err)
	}
	// The image unpacks to 575 MB: a /tmp on a small root is the next thing to fail, so say
	// so plainly instead of dying with "no space left on device" three minutes in.
	var space syscall.Statfs_t
	if err := syscall.Statfs(os.TempDir(), &space); err == nil && space.Bavail*uint64(space.Bsize) < 2<<30 {
		t.Skipf("the image needs 575 MB unpacked and %s has less than 2 GB free", os.TempDir())
	}
	// The install's own unpacker, on the release's own bytes.
	image := filepath.Join(t.TempDir(), "rootfs")
	if err := os.MkdirAll(image, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := update.UnpackAppliance(payload, image); err != nil {
		t.Fatalf("unpacking %s: %v", archive, err)
	}
	// What the unpacker cannot make and the machine needs: this is the assertion that would have
	// caught the beta whose /dev was empty.
	if _, err := os.Lstat(filepath.Join(image, "bin", "sh")); err != nil {
		t.Fatalf("the unpacked image has no /bin/sh: %v", err)
	}
	share := t.TempDir()
	workspace := filepath.Join(share, "workspaces", "general")
	if err := os.MkdirAll(workspace, 0o755); err != nil {
		t.Fatal(err)
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	port := listener.Addr().(*net.TCPAddr).Port
	listener.Close()
	// The one command this proof asks for: a tool in the second workspace, and a tool installed
	// into its own prefix. The files it writes are read from the share afterwards, so the mount,
	// the container, and the prefix are all proved. The absolute paths are the point: the bash
	// tool has no promise about its working directory, and a relative file landed in the
	// container's rootfs instead of the workspace.
	second := filepath.Join(share, "workspaces", "second")
	script := filepath.Join(share, "dev-script.json")
	rules := fmt.Sprintf(`{"rules":[{"match":"prove the second workspace","tools":[{"name":"bash","args":{"command":"pwd; printf second > %s/tool-ran.txt; echo DIAG; id; ls -ld /usr/local /opt; grep -E ' /usr/local | /opt ' /proc/self/mountinfo; stat -c %%d:%%i:%%u /usr/local /opt; { echo '#!/bin/sh'; echo 'printf from-the-prefix-bytes'; } > /usr/local/bin/proof && chmod 755 /usr/local/bin/proof && proof; id -un > %s/whoami.txt; test -s /etc/ssl/certs/ca-certificates.crt && echo present > %s/roots.txt || echo missing > %s/roots.txt; printf home-bytes > ~/home-proof.txt; { echo "HOME=${HOME-unset}"; grep ":999:" /etc/passwd; ls -ld /home/acornfall; grep " /home/acornfall " /proc/self/mountinfo; ls -la /home/acornfall; } > %s/diag.txt 2>&1; ls -ld %s; ls -l %s; hostname"}}],"reply":"the second workspace ran it"}]}`, second, second, second, second, second, second, second)
	if err := os.WriteFile(script, []byte(rules), 0o644); err != nil {
		t.Fatal(err)
	}
	start := strings.Join([]string{
		"ACORNFALL_DEV_SCRIPT=" + script + " exec /usr/local/bin/acornfall",
		"--addr 0.0.0.0:7777 --insecure",
		"--share " + share,
		"--machinery /var/lib/acornfall",
		"--workspace " + workspace,
		"--worker-dir /usr/local/lib/acornfall/worker",
		"--sandbox-engine lxc --in-machine",
		"--model faux/faux-1",
		">>/var/lib/acornfall/appliance.log 2>&1",
	}, " ")
	driver := NewLXC(engine, Machine{
		Image:  image,
		CPUs:   2,
		Memory: "1G",
		Share:  share,
	}, filepath.Join(home, "state", "machine.sock"), "/bin/true").WithLog(t.Logf)
	driver.machine.WithAppliance(start, fmt.Sprintf("127.0.0.1:%d:7777", port))
	t.Cleanup(func() {
		cleanup, cancel := context.WithTimeout(context.Background(), 2*time.Minute)
		defer cancel()
		if err := driver.machine.RemoveMachine(cleanup); err != nil {
			t.Logf("removing the machine: %v", err)
		}
	})
	if err := driver.EnsureMachine(ctx); err != nil {
		t.Fatalf("booting the unpacked release: %v", err)
	}
	url := fmt.Sprintf("http://127.0.0.1:%d", port)
	deadline := time.Now().Add(12 * time.Minute)
	for {
		response, err := http.Get(url + "/api/state")
		if err == nil {
			body, _ := io.ReadAll(io.LimitReader(response.Body, 8192))
			response.Body.Close()
			// The console answering is the proof this test can give: it means the gateway booted
			// from what was unpacked, which is what broke in both betas. Whether a container runs
			// inside it is the other live test's question — a machine has no container until a
			// turn asks for one, so waiting for "RUNNING" here waits forever (measured in CI).
			if response.StatusCode == http.StatusOK {
				t.Logf("the unpacked release boots and serves the console at %s: %.200s", url, body)
				proveASecondWorkspaceRunsTools(t, ctx, url, share, image)
				return
			}
		}
		if time.Now().After(deadline) {
			t.Fatalf("the unpacked release never ran a container on %s: %v", url, err)
		}
		time.Sleep(3 * time.Second)
	}
}
