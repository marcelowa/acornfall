package sandbox

import (
	"context"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/acornfall/acornfall/gateway/internal/shim"
)

// The engine ADR 0021 describes: one microVM per install, and a container per workspace inside
// it. The machine is the pinned engine's (machine.go); the containers are LXC's, driven through
// the shim (internal/shim) over the door the machine publishes — a unix socket the gateway
// listens on, which the engine bridges to the vsock port the shim dials (measured, both
// directions of that sentence: docs/engineering/container-shim.md).
//
// Everything above it sees the usual Driver: create, start, stop, remove, and list mean what
// they mean on a microVM, and the difference is that a workspace costs a container.

// DefaultDoorPort is the machine's vsock port. Every machine has its own vsock device and its
// own host socket, so this number only has to agree with itself on both sides of one machine.
const DefaultDoorPort = 7411

// LXC is the container engine.
type LXC struct {
	engine  *Microsandbox
	machine *MachineEngine
	// door is the host path the gateway listens on, and port the machine's vsock port bridged
	// to it. The listener has to exist before the machine is made: measured, a machine created
	// first dials out into nothing.
	door string
	port int
	// binary is the acornfall binary the machine runs the shim from — this same binary, so the
	// gateway and its shim cannot be different versions — and dir is where a container lives
	// inside the machine.
	binary string
	dir    string
	// privileged runs every container as root in the machine. That is ADR 0021's sharpest trade,
	// and whether a *workspace* may ask for it is one of its open questions: until that is
	// settled the engine runs one profile, and it is the unprivileged one the ADR proposes.
	privileged bool
	// listener and client are the door and the conversation through it, both guarded: several
	// workspaces start at once, and the shim connects on its own schedule.
	mu       sync.Mutex
	listener net.Listener
	client   *shim.Client
	// incoming is what the listener has accepted: one loop accepts for the life of the door, and
	// a connection that arrives while nobody is waiting stays here. Waiting per call was a bug
	// that took a connection with it when the wait timed out — the shim had connected, and the
	// gateway never saw it.
	incoming chan net.Conn
	// dial is how the gateway reaches the shim. Nil accepts on the listener, which is what a
	// machine does; a test injects its own connection.
	dial func(ctx context.Context) (net.Conn, error)
	// log reports what the engine does. Nil silences the engine's own lines, not the manager's.
	log func(string, ...any)
}

// NewLXC builds the engine over the pinned engine's store and install folder. door is where the
// gateway listens for the shim (one unix socket per install); binary is the acornfall executable
// the machine runs it from.
func NewLXC(engine *Microsandbox, machine Machine, door, binary string) *LXC {
	return &LXC{
		engine:  engine,
		machine: NewMachineEngine(engine, machine, filepath.Dir(door)).WithDoor(door, DefaultDoorPort),
		door:    door,
		port:    DefaultDoorPort,
		binary:  binary,
		dir:     "/var/lib/lxc",
	}
}

// WithShimConnection replaces how the gateway reaches the shim, which is how the engine is
// tested without a machine.
func (x *LXC) WithShimConnection(dial func(ctx context.Context) (net.Conn, error)) *LXC {
	x.dial = dial
	return x
}

// WithPrivileged runs containers as root in the machine instead of in a user namespace, for the
// workspaces that need mount, iptables, or a device node.
func (x *LXC) WithPrivileged(privileged bool) *LXC {
	x.privileged = privileged
	return x
}

// WithContainerDir moves where containers live inside the machine. It is the runtime's own
// layout; only a differently built image, or a test, moves it.
func (x *LXC) WithContainerDir(dir string) *LXC {
	x.dir = dir
	return x
}

// WithLog reports what the engine does between calls — a shim that ended, a machine that had to
// be made.
func (x *LXC) WithLog(log func(string, ...any)) *LXC {
	x.log = log
	return x
}

func (x *LXC) Name() string    { return "lxc" }
func (x *LXC) Version() string { return x.engine.Version() }

// Isolated reports that a container separates a workspace from the host: the container is the
// boundary inside the machine, and the machine is the boundary outside it.
func (x *LXC) Isolated() bool { return true }

func (x *LXC) InstallDir() string { return x.engine.InstallDir() }
func (x *LXC) StateDir() string   { return x.engine.StateDir() }
func (x *LXC) Env() []string      { return x.engine.Env() }
func (x *LXC) Installed() bool    { return x.engine.Installed() }

func (x *LXC) Install(ctx context.Context, log func(string, ...any)) error {
	return x.engine.Install(ctx, log)
}

// Usable is the engine's half of the question: a machine to boot, and a hypervisor to boot it
// in. What the machine itself has — the container runtime, the id ranges to map — is answered by
// the first call that reaches it, because a machine does not exist until a workspace needs one.
// Usable reports whether a container can be made here. Two things have to be true: the machine.s
// own runtime is there, and the machine knows which folder it mounts — a workspace outside it is
// one its containers cannot see, and ADR 0021 leaves that choice to a person (--root). A run
// that never made a machine has not chosen, and a report that said "ready" would be saying
// something nobody decided.
func (x *LXC) Usable() error {
	if strings.TrimSpace(x.machine.Machine().Share) == "" {
		return fmt.Errorf("%w: no share is chosen: name the folder the machine mounts (--share), which is what a workspace's container binds", ErrUnavailable)
	}
	return x.engine.Usable()
}

// Nesting is the machine's answer, not a container's: the containers are where a workspace's own
// virtual machines would run, and the device has to exist in the machine for any of them.
func (x *LXC) Nesting(ctx context.Context) NestingSupport { return x.engine.Nesting(ctx) }

// EnsureMachine opens the door and makes sure the machine is there and booted. MachineLayer.
func (x *LXC) EnsureMachine(ctx context.Context) error {
	if err := x.listen(); err != nil {
		return err
	}
	return x.machine.EnsureMachine(ctx)
}

func (x *LXC) listen() error {
	x.mu.Lock()
	defer x.mu.Unlock()
	if x.listener != nil {
		return nil
	}
	if strings.TrimSpace(x.door) == "" {
		return errors.New("sandbox: this engine has no shim door: the gateway has nowhere to listen")
	}
	if err := os.Remove(x.door); err != nil && !os.IsNotExist(err) {
		return err
	}
	if err := os.MkdirAll(filepath.Dir(x.door), 0o755); err != nil {
		return err
	}
	listener, err := net.Listen("unix", x.door)
	if err != nil {
		return fmt.Errorf("sandbox: cannot listen for the container shim at %s: %w", x.door, err)
	}
	x.incoming = make(chan net.Conn, 4)
	go func() {
		for {
			conn, err := listener.Accept()
			if err != nil {
				return
			}
			if x.log != nil {
				x.log("the shim connected to %s", x.door)
			}
			x.incoming <- conn
		}
	}()
	// What connects through this socket comes through the engine's bridge, which is a local
	// process's business: the door is not open to other users of the machine.
	if err := os.Chmod(x.door, 0o600); err != nil {
		listener.Close()
		return err
	}
	x.listener = listener
	return nil
}

// shimClient is the live connection to the shim, connecting one or starting the shim when there
// is none: a machine boots without it, and the first call to need one delivers it.
func (x *LXC) shimClient(ctx context.Context) (*shim.Client, error) {
	x.mu.Lock()
	if x.client != nil {
		select {
		case <-x.client.Closed():
			x.client = nil
		default:
			client := x.client
			x.mu.Unlock()
			return client, nil
		}
	}
	x.mu.Unlock()

	conn, err := x.connect(ctx)
	if err != nil {
		return nil, err
	}
	client := shim.NewClient(conn)
	hello, err := client.Hello(ctx)
	if err != nil {
		client.Close()
		return nil, err
	}
	if hello.Runtime == "" {
		client.Close()
		return nil, fmt.Errorf("%w: the machine has no container runtime: its image needs one (lxc), which is what the appliance image is for", ErrUnavailable)
	}
	x.mu.Lock()
	x.client = client
	x.mu.Unlock()
	return client, nil
}

// connect waits for the shim to dial in, and starts it inside the machine when nothing does:
// the gateway puts its own binary there and runs the shim from it. One copy and one exec per
// machine, because after that the shim reconnects by itself.
func (x *LXC) connect(ctx context.Context) (net.Conn, error) {
	if err := x.listen(); err != nil {
		return nil, err
	}
	if conn, err := x.accept(ctx, 2*time.Second); err == nil {
		return conn, nil
	}
	if err := x.startShim(ctx); err != nil {
		return nil, err
	}
	// Patiently: the machine may be booting, the copy is 19MB, and the shim has to start and
	// dial. Measured, thirty seconds was not enough on a machine that had just come up, and the
	// failure looked like a door that does not work rather than a shim still arriving.
	return x.accept(ctx, 3*time.Minute)
}

func (x *LXC) accept(ctx context.Context, within time.Duration) (net.Conn, error) {
	if x.dial != nil {
		return x.dial(ctx)
	}
	x.mu.Lock()
	incoming := x.incoming
	x.mu.Unlock()
	if incoming == nil {
		return nil, errors.New("sandbox: the shim door is not open")
	}
	timer := time.NewTimer(within)
	defer timer.Stop()
	select {
	case conn := <-incoming:
		return conn, nil
	case <-timer.C:
		if x.log != nil {
			x.log("nothing connected to %s within %s", x.door, within)
		}
		return nil, fmt.Errorf("sandbox: nothing connected to the shim door at %s within %s", x.door, within)
	case <-ctx.Done():
		return nil, ctx.Err()
	}
}

func (x *LXC) startShim(ctx context.Context) error {
	if strings.TrimSpace(x.binary) == "" {
		return errors.New("sandbox: this engine does not know which binary to run the shim from")
	}
	if _, err := os.Stat(x.binary); err != nil {
		return fmt.Errorf("sandbox: the binary to run the shim from is not there: %w", err)
	}
	name := x.machine.Name()
	target := "/usr/local/bin/acornfall"
	log := "/var/log/acornfall-shim.log"
	if _, err := x.engine.run(ctx, "copy", x.binary, name+":"+target); err != nil {
		// A copy onto a running binary is refused ("text file busy"), and that is the shim already
		// being there: the copy is only how it arrives the first time.
		if !strings.Contains(err.Error(), "busy") {
			return fmt.Errorf("sandbox: putting the shim into %s: %w", name, err)
		}
		if x.log != nil {
			x.log("the shim is already in %s; leaving it alone", name)
		}
	}
	// The shim stays up inside the machine and dials out; the command that started it is only
	// its supervisor, so it is started and left running rather than waited for. Its output goes
	// to the machine's own console: the shim reports through the protocol, and the gateway's log
	// is not where a machine's noise belongs.
	// Its own log inside the machine, appended: a shim that cannot reach the door is otherwise a
	// machine that sits there, and the gateway has no console to read.
	script := fmt.Sprintf("exec %s shim --vsock %d >> %s 2>&1", target, x.port, log)
	command := exec.CommandContext(ctx, x.engine.binary(), "exec", name, "--", "sh", "-c", script)
	command.Env = append(os.Environ(), x.engine.Env()...)
	if err := command.Start(); err != nil {
		return fmt.Errorf("sandbox: starting the shim in %s: %w", name, err)
	}
	go func() {
		if err := command.Wait(); err != nil && x.log != nil {
			x.log("the shim in %s ended: %v", name, err)
		}
	}()
	return nil
}

// List is every container this install has, and nothing of the engine's own store: the machine is
// not a workspace and must never be reported as one.
//
// It is a read. It does not create the machine and it does not start the shim, because doctor
// asks this question about an install that has never made one, and a report that creates things
// is not a report — measured: `doctor --sandbox-engine lxc` tried to copy the shim into a machine
// that did not exist and reported the copy failure as the sandbox's problem. A machine that is
// not there has no containers; the first workspace is what makes it.
func (x *LXC) List(ctx context.Context) ([]Instance, error) {
	if err := x.listen(); err != nil {
		return nil, err
	}
	conn, err := x.accept(ctx, time.Second)
	if err != nil {
		return nil, nil
	}
	client := shim.NewClient(conn)
	defer client.Close()
	hello, err := client.Hello(ctx)
	if err != nil {
		return nil, nil
	}
	if hello.Runtime == "" {
		return nil, fmt.Errorf("%w: the machine has no container runtime: its image needs one (lxc), which is what the appliance image is for", ErrUnavailable)
	}
	containers, err := client.List(ctx)
	if err != nil {
		return nil, err
	}
	instances := make([]Instance, 0, len(containers))
	for _, container := range containers {
		instances = append(instances, Instance{Name: container.Name, Status: container.Status, Problem: container.Problem})
	}
	return instances, nil
}

// Create makes one workspace's container: the rootfs from the workspace's image, the
// configuration the policy maps to, and the mounts the policy names — and nothing else.
func (x *LXC) Create(ctx context.Context, policy Policy, policyDir string) error {
	container, settings, err := x.container(policy)
	if err != nil {
		return err
	}
	if err := x.EnsureMachine(ctx); err != nil {
		return err
	}
	config, err := prepareContainer(container, settings, policyDir)
	if err != nil {
		return err
	}
	client, err := x.shimClient(ctx)
	if err != nil {
		return err
	}
	payload := shim.CreatePayload{
		Name:    container.Name,
		Network: networkPayload(settings.Network),
		// The image that becomes the rootfs is the container's, which went through the
		// policy's defaults: a workspace that never named one has an empty policy image.
		Image:       container.Image,
		Dir:         settings.Dir,
		Config:      string(config),
		Owner:       settings.UID,
		Group:       settings.GID,
		RootfsOwner: settings.RootfsOwner(),
		RootfsGroup: settings.RootfsGroup(),
		Home:        policy.Workspace,
	}
	for _, bind := range container.Binds {
		payload.Binds = append(payload.Binds, shim.Bind{Source: bind.Source, Target: bind.Target, File: bind.File})
	}
	return client.Create(ctx, payload)
}

func (x *LXC) Start(ctx context.Context, name string) error {
	client, err := x.shimClient(ctx)
	if err != nil {
		return err
	}
	return client.Start(ctx, name)
}

func (x *LXC) Stop(ctx context.Context, name string) error {
	client, err := x.shimClient(ctx)
	if err != nil {
		return err
	}
	return client.Stop(ctx, name)
}

func (x *LXC) Remove(ctx context.Context, name string) error {
	client, err := x.shimClient(ctx)
	if err != nil {
		return err
	}
	return client.Remove(ctx, name)
}

// container maps a workspace's policy onto a container and its settings. The mapping itself is
// shared with the engine inside the machine (ContainerFor), so a workspace's container cannot
// differ by which of the two is running.
func (x *LXC) container(policy Policy) (Container, LXCSettings, error) {
	return containerForOwner(policy, x.machine.Machine().Share, x.dir, x.privileged, x.engine.hostNesting().Available, x.machine.Machine().MemoryBytes(), shareOwner(x.machine.Machine().Share))
}

// WithAppliance is the machine booting as the product (ADR 0022): the script it runs as its init,
// and the port its console is published on. It is the host-side engine's way of saying what the
// engine inside the machine already is, and it is passed through because the machine's own
// configuration is where both live.
func (x *LXC) WithAppliance(start, forward string) *LXC {
	x.machine.WithAppliance(start, forward)
	return x
}

// MachineName is the machine this install has, for a person asking.
func (x *LXC) MachineName() string { return x.machine.Name() }

// Engine is the pinned engine underneath: the launcher installs it before the machine can boot.
func (x *LXC) Engine() *Microsandbox { return x.engine }

// RemoveMachine takes the machine away: an init is fixed at boot, so installing a new appliance
// is replacing the machine. The product is in the mount, which is not part of the machine.
func (x *LXC) RemoveMachine(ctx context.Context) error { return x.machine.RemoveMachine(ctx) }

// MachineStop shuts the machine down the way it can shut itself down: its init is the appliance's
// gateway, which exits on SIGTERM, and an init that exits is a machine that powers off. The
// engine's own stop asks the machine to stop gracefully, and nothing inside answers that — a
// person reads the wait as "it does not stop" (measured on a real install).
// prepareContainer makes everything a container needs before the runtime sees it: the folders its
// binds come from, the configuration itself, and the copy a person can read. Both drivers do it,
// and they used to do it twice, in two functions that were the same function — which is how beta
// 55 mounted no prefix at all: the in-machine path did not make the source folder, the runtime
// skipped the optional mount, and the workspace installed into a rootfs that was about to be
// thrown away. One copy, so the next step added to one driver is added to both.
func prepareContainer(container Container, settings LXCSettings, policyDir string) ([]byte, error) {
	// A mount whose source is absent is skipped by the runtime, quietly (`optional`), so a prefix
	// that was never made would be a workspace with no prefix and no error anywhere. Make the
	// folders this container declared, and nothing else.
	for _, bind := range container.Binds {
		if err := ensureBindSource(bind, settings.UID, settings.GID); err != nil {
			return nil, err
		}
	}
	config, err := container.LXCConfig(settings)
	if err != nil {
		return nil, err
	}
	if strings.TrimSpace(policyDir) == "" {
		return nil, errors.New("sandbox: no directory for the container's configuration")
	}
	if err := os.MkdirAll(policyDir, 0o755); err != nil {
		return nil, err
	}
	// A person reads what the workspace's container is allowed to be, the way a microVM
	// sandbox's policy file is readable.
	if err := os.WriteFile(filepath.Join(policyDir, "container.conf"), config, 0o644); err != nil {
		return nil, err
	}
	return config, nil
}

// prefixLayout is what a prefix's folder holds the first time it is made: the layout the image's
// own /usr/local has, because the bind replaces the folder wholesale. A mount over /usr/local
// hides the image's bin along with everything else, and a toolchain that cannot write
// /usr/local/bin has no prefix at all — which is how beta 55, 56 and 57 failed after the mount
// had already landed: the first install said "cannot create /usr/local/bin/proof: Directory
// nonexistent" (measured in the release proof).
var prefixLayout = []string{"bin", "etc", "games", "include", "lib", "libexec", "man", "sbin", "share", "src"}

// ensureBindSource makes a bind's source folder where it is missing, gives it the layout its
// target needs, and hands it to the share's owner. Only a folder that did not exist is touched:
// a workspace's own folder already belongs to somebody, and this is not the place to say
// otherwise.
func ensureBindSource(bind Bind, uid, gid int) error {
	if bind.File || strings.TrimSpace(bind.Source) == "" {
		return nil
	}
	if _, err := os.Stat(bind.Source); err == nil {
		return nil
	}
	made := []string{bind.Source}
	if err := os.MkdirAll(bind.Source, 0o755); err != nil {
		return fmt.Errorf("sandbox: making the prefix %s: %w", bind.Source, err)
	}
	if bind.Target == "/usr/local" {
		for _, name := range prefixLayout {
			path := filepath.Join(bind.Source, name)
			if err := os.MkdirAll(path, 0o755); err != nil {
				return fmt.Errorf("sandbox: making %s in the prefix %s: %w", name, bind.Source, err)
			}
			made = append(made, path)
		}
	}
	if uid > 0 {
		// Best effort: the machine normalizes the share's owner (ADR 0021), so a chown the mount
		// refuses is somebody else's rule doing its job, not a failure to report here.
		for _, path := range made {
			_ = os.Chown(path, uid, gid)
		}
	}
	return nil
}

func (x *LXC) MachineStop(ctx context.Context) error {
	if !x.engine.Installed() {
		return nil
	}
	name := x.machine.Name()
	// sh -c, because kill is a shell builtin on Debian and the image does not carry the
	// standalone binary: the direct call fails with "failed to exec kill" and a graceful stop
	// never happens (measured on a real install, where stop was the documented way to stop).
	if _, err := x.engine.run(ctx, "exec", name, "--", "sh", "-c", "kill -TERM 1"); err != nil {
		return fmt.Errorf("sandbox: asking the machine to stop: %w", err)
	}
	// The engine sees the VM go away on its own; the record is what needs settling, and a stop
	// with a budget is how it settles without waiting forever.
	if err := x.engine.Stop(ctx, name); err != nil {
		return err
	}
	return nil
}
