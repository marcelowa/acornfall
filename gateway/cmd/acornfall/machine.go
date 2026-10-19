package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"

	"github.com/acornfall/acornfall/gateway/internal/layout"
	"github.com/acornfall/acornfall/gateway/internal/sandbox"
	"github.com/acornfall/acornfall/gateway/internal/update"
)

// machineCommand is the host's side of ADR 0022: the host is a launcher, and the product is a
// machine. It boots the one machine — whose init is the appliance itself, with the mount as its
// world — and tells a person where the console is. Nothing of the product runs here.
func machineCommand(argv []string) {
	if len(argv) == 0 {
		machineUsage()
		return
	}
	switch argv[0] {
	case "up":
		machineUp(argv[1:])
	case "status":
		machineStatus(argv[1:])
	default:
		machineUsage()
	}
}

func machineUsage() {
	fmt.Fprint(os.Stderr, `acornfall machine: the one machine an install runs in.

  acornfall machine up      boot it, and say where the console is
  acornfall machine status  whether it is there and running

The machine runs the appliance: the gateway and the worker inside it, with ~/acornfall mounted
as the product (config, state, workspaces). Nothing of the product runs on the host.
`)
}

// machineUp boots the machine and waits for its console. Running it again is not a second
// machine: the engine finds the one this install has and leaves it alone.
func machineUp(argv []string) {
	flags := flag.NewFlagSet("acornfall machine up", flag.ContinueOnError)
	root := flags.String("root", "", "the folder the machine mounts: the product (default: ~/acornfall)")
	home := flags.String("home", "", "the machinery folder (default: ~/.acornfall)")
	image := flags.String("image", "", "the appliance image, an unpacked rootfs (default: <home>/appliance/rootfs)")
	tag := flags.String("tag", "", "the release to fetch the appliance from (default: this build's version)")
	refresh := flags.Bool("refresh", false, "fetch the appliance again and recreate the machine: an init is fixed at boot, so an update is a new machine")
	port := flags.Int("port", 7777, "the host port the console is published on, on loopback")
	cpus := flags.Int("cpus", 2, "virtual cpus for the machine")
	memory := flags.String("memory", "4G", "memory for the machine")
	wait := flags.Duration("wait", 3*time.Minute, "how long to wait for the console; zero does not wait")
	if err := flags.Parse(argv); err != nil {
		os.Exit(2)
	}
	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Minute)
	defer cancel()

	resolvedRoot, err := resolveRoot(*root, "")
	if err != nil {
		log.Fatalf("acornfall machine: %v", err)
	}
	resolvedHome, err := resolveDataDir(*home)
	if err != nil {
		log.Fatalf("acornfall machine: %v", err)
	}
	resolvedImage := *image
	if resolvedImage == "" {
		resolvedImage = filepath.Join(resolvedHome, "appliance", "rootfs")
	}
	// The mount is the product, so it has to be there before the machine is: the machine mounts
	// it, and a machine whose world is missing boots into a console with no workspaces.
	where := layout.New(resolvedRoot, resolvedHome)
	if err := where.Ensure(); err != nil {
		log.Fatalf("acornfall machine: %v", err)
	}
	// The token, when the install has one, comes from the mount: the appliance has no secrets of
	// its own, and a port that answers without one is only safe while it is loopback.
	token := ""
	if contents, err := os.ReadFile(where.Token()); err == nil {
		token = strings.TrimSpace(string(contents))
	}
	if err := ensureAppliance(ctx, resolvedHome, resolvedImage, *refresh, *tag); err != nil {
		log.Fatalf("acornfall machine: %v", err)
	}
	driver, err := machineDriver(resolvedHome, resolvedImage, resolvedRoot, *cpus, *memory, *port, applianceInit(resolvedRoot, token))
	if err != nil {
		log.Fatalf("acornfall machine: %v", err)
	}
	engine := driver.Engine()
	if err := engine.Install(ctx, log.Printf); err != nil {
		log.Fatalf("acornfall machine: %v", err)
	}
	if *refresh {
		// An init is fixed at boot: a new image is a new machine, and the product is in the mount,
		// so nothing of it is lost.
		// The engine writes the machine's containers into the image it booted from, so an image
		// that has been booted carries them: a new machine made from it would start with a
		// stranger's containers on its disk.
		if err := os.RemoveAll(filepath.Join(resolvedImage, "var", "lib", "lxc")); err != nil {
			log.Fatalf("acornfall machine: cleaning the image's containers: %v", err)
		}
		if err := driver.RemoveMachine(ctx); err != nil {
			log.Fatalf("acornfall machine: removing the old machine: %v", err)
		}
	}
	log.Printf("machine: booting the appliance from %s", resolvedImage)
	if err := driver.EnsureMachine(ctx); err != nil {
		log.Fatalf("acornfall machine: %v", err)
	}
	url := fmt.Sprintf("http://127.0.0.1:%d", *port)
	log.Printf("machine: the console is %s", url)
	if *wait <= 0 {
		return
	}
	if err := awaitConsole(ctx, url, token, *wait); err != nil {
		log.Fatalf("acornfall machine: %v", err)
	}
	log.Printf("machine: the appliance is serving on %s", url)
}

// machineStatus reports whether the machine is there, without making anything: asking a machine
// how it is must not be the thing that creates it.
func machineStatus(argv []string) {
	flags := flag.NewFlagSet("acornfall machine status", flag.ContinueOnError)
	home := flags.String("home", "", "the machinery folder (default: ~/.acornfall)")
	root := flags.String("root", "", "the folder the machine mounts (default: ~/acornfall)")
	image := flags.String("image", "", "the appliance image (default: <home>/appliance/rootfs)")
	if err := flags.Parse(argv); err != nil {
		os.Exit(2)
	}
	resolvedHome, err := resolveDataDir(*home)
	if err != nil {
		log.Fatalf("acornfall machine: %v", err)
	}
	resolvedRoot, err := resolveRoot(*root, "")
	if err != nil {
		log.Fatalf("acornfall machine: %v", err)
	}
	resolvedImage := *image
	if resolvedImage == "" {
		resolvedImage = filepath.Join(resolvedHome, "appliance", "rootfs")
	}
	driver, err := machineDriver(resolvedHome, resolvedImage, resolvedRoot, 2, "4G", 7777, applianceInit(resolvedRoot, ""))
	if err != nil {
		log.Fatalf("acornfall machine: %v", err)
	}
	ctx, cancel := context.WithTimeout(context.Background(), time.Minute)
	defer cancel()
	name := driver.MachineName()
	if !driver.Engine().Installed() {
		// Asking how the machine is must not install anything: a machine that was never booted
		// here has no engine, which is the same answer as no machine.
		fmt.Printf("%s: not made yet (acornfall machine up boots it; the sandbox engine is not installed)\n", name)
		return
	}
	instances, err := driver.Engine().List(ctx)
	if err != nil {
		log.Fatalf("acornfall machine: %v", err)
	}
	for _, instance := range instances {
		if instance.Name != name {
			continue
		}
		state := "stopped"
		if instance.Running() {
			state = "running"
		}
		fmt.Printf("%s: %s\n", name, state)
		return
	}
	fmt.Printf("%s: not made yet (acornfall machine up boots it)\n", name)
}

// machineDriver is the engine plus the machine the appliance runs in. The door is not used by
// the appliance's own gateway — it is in the machine, and its containers are its neighbours —
// but the machine's configuration still carries it, because the host may need the same door for
// the engine that reaches containers from outside (internal/sandbox/lxcengine.go).
func machineDriver(home, image, root string, cpus int, memory string, port int, start string) (*sandbox.LXC, error) {
	binary, err := os.Executable()
	if err != nil {
		return nil, fmt.Errorf("this binary's own path is what the machine runs the shim from: %w", err)
	}
	engine := sandbox.NewMicrosandbox(home)
	machine := sandbox.Machine{
		Image:     image,
		CPUs:      cpus,
		Memory:    memory,
		ShareRoot: root,
	}
	driver := sandbox.NewLXC(engine, machine, filepath.Join(home, "state", "machine.sock"), binary)
	driver = driver.WithAppliance(start, fmt.Sprintf("127.0.0.1:%d:7777", port))
	return driver, nil
}

// applianceInit is what the machine runs as its init: the product, out of the image, with the
// mount as its world. There is no provider flag and no model flag here — they come from the
// mount, which is the point of the layout (ADR 0022): the machine holds nothing of the
// product's, so it can be replaced without losing any. The token, when there is one, comes from
// the mount for the same reason; without one the port is only published on loopback.
func applianceInit(root, token string) string {
	machineHome := "/var/lib/acornfall"
	workspace := filepath.Join(root, "workspaces", "general")
	auth := "--insecure"
	if token != "" {
		auth = "--token " + token
	}
	return strings.Join([]string{
		// Everything the appliance says goes to a file inside the machine: it is the only place a
		// container that failed to start explains itself, and the console is not readable.
		"exec /usr/local/bin/acornfall",
		"--addr 0.0.0.0:7777 " + auth,
		"--root " + root,
		"--home " + machineHome,
		"--workspace " + workspace,
		"--worker-dir /usr/local/lib/acornfall/worker",
		"--sandbox-engine lxc --in-machine",
		">>" + filepath.Join(machineHome, "appliance.log") + " 2>&1",
	}, " ")
}

// ensureAppliance makes sure the machine's rootfs is there: an install that has one uses it, and
// a fresh install fetches the release's, verified against the release's own checksums. A refresh
// always fetches — that is what updating the appliance means, because the image is the product's
// half of the machine.
func ensureAppliance(ctx context.Context, home, image string, refresh bool, tag string) error {
	if !refresh {
		if err := checkAppliance(image); err == nil {
			return nil
		}
	}
	if tag == "" {
		tag = update.BuildVersion
	}
	if tag == "" {
		return fmt.Errorf("this build does not know its own version, so it cannot say which release the appliance comes from: pass --image or --tag")
	}
	log.Printf("machine: fetching the appliance %s into %s", tag, image)
	return update.New(home, filepath.Dir(home), "", "").FetchAppliance(ctx, tag, image)
}

// checkAppliance refuses an image that is not one, by name: the machine's error for a missing
// rootfs is "failed to start", which says nothing about what to do.
func checkAppliance(image string) error {
	for _, path := range []string{"usr/local/bin/acornfall", "usr/local/lib/acornfall/worker/src/main.ts"} {
		if _, err := os.Stat(filepath.Join(image, path)); err != nil {
			return fmt.Errorf("%s is not an appliance image (no %s): build one with scripts/build-appliance.sh, or unpack the release's", image, path)
		}
	}
	return nil
}

// awaitConsole waits for the appliance's own state endpoint: a published port that answers is
// the machine being ready, and anything earlier is a window that looks like a broken install.
func awaitConsole(ctx context.Context, url, token string, within time.Duration) error {
	deadline := time.Now().Add(within)
	client := &http.Client{Timeout: 5 * time.Second}
	for {
		request, err := http.NewRequestWithContext(ctx, http.MethodGet, url+"/api/state", nil)
		if err != nil {
			return err
		}
		if token != "" {
			request.Header.Set("Authorization", "Bearer "+token)
		}
		response, requestErr := client.Do(request)
		err = requestErr
		if err == nil {
			response.Body.Close()
			if response.StatusCode == http.StatusOK {
				return nil
			}
		}
		if time.Now().After(deadline) {
			return fmt.Errorf("the machine's console never answered on %s within %s", url, within)
		}
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(2 * time.Second):
		}
	}
}
