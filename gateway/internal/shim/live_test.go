package shim

import (
	"context"
	"net"
	"os"
	"path/filepath"
	"strings"
	"syscall"
	"testing"
	"time"

	"github.com/acornfall/acornfall/gateway/internal/sandbox"
)

// Live: the container layer against a real runtime, inside a machine. It is gated rather than
// part of a tier because it needs the container runtime installed in the guest and the id ranges
// an unprivileged container maps — what the appliance image will carry, and what a machine
// without them says so instead of failing three calls later.
//
//	ACORNFALL_LXC=1 go test ./internal/shim -run Live -v
func liveShim(t *testing.T) *Client {
	t.Helper()
	if os.Getenv("ACORNFALL_LXC") == "" {
		t.Skip("set ACORNFALL_LXC=1 to drive a real container runtime")
	}
	server := &Server{Version: "test", Log: t.Logf}
	client, shim := net.Pipe()
	go func() {
		if err := server.Serve(shim); err != nil {
			t.Logf("serve: %v", err)
		}
	}()
	live := NewClient(client)
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	answer, err := live.Hello(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if answer.Runtime == "" {
		t.Skip("no container runtime in this machine (apt-get install -y lxc skopeo umoci jq)")
	}
	if !strings.Contains(answer.IDs, ":100000:") {
		t.Skipf("this machine maps no unprivileged range; add `root:100000:65536` to /etc/subuid and /etc/subgid (got %q)", answer.IDs)
	}
	return live
}

func TestLiveTheShimDrivesAWorkspaceContainer(t *testing.T) {
	client := liveShim(t)
	defer client.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 8*time.Minute)
	defer cancel()

	const name = "acornfall-shim-live"
	dir := filepath.Join("/var/lib/lxc", name)
	// The share the container binds: a real folder of the user's, owned by the mapped user and
	// traversable by it. A bind of a folder only root can enter mounts and then refuses the
	// workspace's own uid — measured — which is why the modes here are the ones a home has.
	share := filepath.Join("/var/tmp", name+"-share")
	if err := os.RemoveAll(share); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(share, 0o755); err != nil {
		t.Fatal(err)
	}
	defer os.RemoveAll(share)
	marker := filepath.Join(share, "marker.txt")
	if err := os.WriteFile(marker, []byte("from the share\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.Chown(marker, 1000, 1000); err != nil {
		t.Fatal(err)
	}
	if err := os.Chown(share, 1000, 1000); err != nil {
		t.Fatal(err)
	}
	defer func() {
		cleanup, cancel := context.WithTimeout(context.Background(), time.Minute)
		defer cancel()
		if os.Getenv("KEEP") == "" {
			_ = client.Remove(cleanup, name)
		}
	}()

	// The config is the gateway's: the shim applies what the policy mapped to, which is the
	// other half of this test — the two have to fit together.
	container := sandbox.Container{
		Name:        name,
		Image:       "debian:stable-slim",
		CPUs:        2,
		MemoryBytes: 1 << 30,
		Binds:       []sandbox.Bind{{Source: share, Target: share}},
	}
	config, err := container.LXCConfig(sandbox.LXCSettings{
		Dir:          dir,
		Unprivileged: true,
		UID:          1000,
		GID:          1000,
		Init:         "/bin/sleep infinity",
	})
	if err != nil {
		t.Fatal(err)
	}
	if err := client.Create(ctx, CreatePayload{
		Name:   name,
		Image:  "debian:stable-slim",
		Dir:    dir,
		Config: string(config),
		Binds:  []Bind{{Source: share, Target: share}},
		Owner:  1000,
		Group:  1000,
	}); err != nil {
		t.Fatal(err)
	}

	instances, err := client.List(ctx)
	if err != nil {
		t.Fatal(err)
	}
	found := false
	for _, instance := range instances {
		if instance.Name == name {
			found = true
			if instance.Running {
				t.Errorf("%s should not be running before it is started", name)
			}
		}
	}
	if !found {
		t.Fatalf("%s is not in %v", name, instances)
	}
	if err := client.Start(ctx, name); err != nil {
		t.Fatal(err)
	}

	// The limits the policy named are the container's cgroup, from the machine's side: an
	// unprivileged container has no /sys/fs/cgroup of its own to read them from.
	limits, err := os.ReadFile(filepath.Join("/sys/fs/cgroup/lxc.payload."+name, "memory.max"))
	if err == nil && strings.TrimSpace(string(limits)) != "1073741824" {
		t.Errorf("memory.max = %q, want the policy's 1 GiB", strings.TrimSpace(string(limits)))
	}

	// A command runs in it, as the user the workspace belongs to.
	var seen strings.Builder
	exit, err := client.Exec(ctx, ExecPayload{
		Name: name,
		Argv: []string{"sh", "-c", "cat /etc/os-release; id -u; cat " + filepath.Join(share, "marker.txt")},
		Cwd:  share,
		UID:  1000,
		GID:  1000,
	}, func(_ string, data []byte) { seen.Write(data) })
	if err != nil {
		t.Fatal(err)
	}
	if exit.Code != 0 {
		t.Fatalf("exit = %+v, output %q", exit, seen.String())
	}
	for _, want := range []string{"Debian", "\n1000\n", "from the share"} {
		if !strings.Contains(seen.String(), want) {
			t.Errorf("output should hold %q, got %q", want, seen.String())
		}
	}

	// Writing in the share lands as the user, which is what "the workspace belongs to the
	// person" means once the container is in the way.
	if _, err := client.Exec(ctx, ExecPayload{
		Name: name,
		Argv: []string{"sh", "-c", "echo written > " + filepath.Join(share, "written.txt")},
		UID:  1000,
		GID:  1000,
	}, nil); err != nil {
		t.Fatal(err)
	}
	info, err := os.Stat(filepath.Join(share, "written.txt"))
	if err != nil {
		t.Fatal(err)
	}
	if owned, ok := info.Sys().(*syscall.Stat_t); ok && owned.Uid != 1000 {
		t.Errorf("a file written through the container belongs to the user: uid %d", owned.Uid)
	}

	// The kill, which is the reason the shim exists: the command must be gone inside the
	// container, and the container's own init must be untouched.
	stopped, cancelExec := context.WithCancel(ctx)
	go func() {
		time.Sleep(500 * time.Millisecond)
		cancelExec()
	}()
	// `tail` and not `sleep`: the container's own init is a sleep, and a check that cannot tell
	// the command from the init would report the kill as broken or as a success by accident.
	exit, err = client.Exec(stopped, ExecPayload{Name: name, Argv: []string{"tail", "-f", "/dev/null"}, UID: 1000, GID: 1000}, nil)
	cancelExec()
	if err != nil {
		t.Fatal(err)
	}
	if exit.Stopped != "killed" {
		t.Errorf("exit = %+v, want it stopped", exit)
	}
	// Every process inside the container, by the name the kernel knows them by.
	var names strings.Builder
	if _, err := client.Exec(ctx, ExecPayload{
		Name: name,
		Argv: []string{"sh", "-c", "for p in /proc/[0-9]*; do cat $p/comm 2>/dev/null; done"},
	}, func(_ string, data []byte) { names.Write(data) }); err != nil {
		t.Fatal(err)
	}
	count := func(process string) int {
		total := 0
		for _, line := range strings.Split(names.String(), "\n") {
			if strings.TrimSpace(line) == process {
				total++
			}
		}
		return total
	}
	if alive := count("tail"); alive != 0 {
		t.Errorf("the killed command is still running inside the container: %d", alive)
	}
	if init := count("sleep"); init != 1 {
		t.Errorf("the container's own init should have survived the kill: %d sleeps", init)
	}

	if err := client.Stop(ctx, name); err != nil {
		t.Fatal(err)
	}
	if err := client.Remove(ctx, name); err != nil {
		t.Fatal(err)
	}
}
