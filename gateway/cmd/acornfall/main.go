package main

import (
	"context"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"log"
	"net"
	"net/http"
	"os"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/acornfall/acornfall/gateway/internal/control"
	"github.com/acornfall/acornfall/gateway/internal/httpapi"
	"github.com/acornfall/acornfall/gateway/internal/sandbox"
	"github.com/acornfall/acornfall/gateway/web"
)

func main() {
	// One place configures logging, and it is the entry point: a package that sets global
	// logger state when it is imported decides something the program did not ask for.
	log.SetFlags(log.Ltime)
	if len(os.Args) > 1 && os.Args[1] == "provider" {
		providers(os.Args[2:])
		return
	}
	if len(os.Args) > 1 && os.Args[1] == "workspace" {
		workspaceCommand(os.Args[2:])
		return
	}
	if len(os.Args) > 1 && os.Args[1] == "doctor" {
		doctorCommand(os.Args[2:])
		return
	}
	if err := serve(os.Args[1:]); err != nil {
		log.Fatalf("acornfall: %v", err)
	}
}

func serve(argv []string) error {
	flags := flag.NewFlagSet("acornfall", flag.ContinueOnError)
	addr := flags.String("addr", "127.0.0.1:7777", "listen address; a non-loopback address requires a token")
	token := flags.String("token", "", "shared secret; generated and stored when a non-loopback address has none")
	insecure := flags.Bool("insecure", false, "listen without a token (trusted network or tunnel only)")
	workspace := flags.String("workspace", "", "the general workspace's folder (default: the folder acornfall is started in)")
	home := flags.String("home", "", "the acornfall folder: config, credentials, state, workspaces (default: ~/.acornfall)")
	dataDir := flags.String("data-dir", "", "alias for --home")
	workspacesDir := flags.String("workspaces-dir", "", "where workspaces are created (default: ~/acornfall/workspaces)")
	sandboxState := flags.String("sandbox-state", "", "where sandboxes, images, and snapshots are kept (default: <home>/sandboxes); must be a short path")
	sandboxEngine := flags.String("sandbox-engine", "", "which engine runs the tools: microsandbox (default; needs a hypervisor) or host (no isolation)")
	disableVMNesting := flags.Bool("disable-vm-nesting", false, "keep a workspace's sandbox from nesting virtual machines; by default a sandbox nests when the engine and the machine can, and a workspace's own setting wins")
	model := flags.String("model", "", "default model as provider/modelId")
	workerCommand := flags.String("worker", "", `worker command (default: "bun run src/main.ts")`)
	workerDir := flags.String("worker-dir", "", "worker directory")
	if err := flags.Parse(argv); err != nil {
		return err
	}

	dir := *home
	if dir == "" {
		dir = *dataDir
	}
	resolved, err := resolveDataDir(dir)
	if err != nil {
		return err
	}
	dir = resolved
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	// The user's home is resolved here rather than inside control: the sandbox mounts `~/.agents`
	// at the same path the worker reads it from, and both have to be answering about the same
	// folder. The resource folders are created now so a sandbox always has somewhere to mount
	// from, even before anything has been written to them.
	userHome, err := os.UserHomeDir()
	if err != nil {
		return fmt.Errorf("cannot tell where the user's home is: %w", err)
	}
	if err := sandbox.EnsureGlobal(dir, userHome); err != nil {
		return err
	}
	// The general workspace's folder: the folder the install was started in, unless told
	// otherwise. An existing single-workspace install therefore keeps working where it was.
	general := *workspace
	if general == "" {
		if cwd, err := os.Getwd(); err == nil {
			general = cwd
		}
	}
	worker, err := resolveWorkerDir(*workerDir)
	if err != nil {
		return err
	}

	command := []string{"bun", "run", "src/main.ts"}
	if *workerCommand != "" {
		command = strings.Fields(*workerCommand)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	guard, err := httpapi.ResolveToken(*token, os.Getenv("ACORNFALL_TOKEN"), dir, *addr, *insecure)
	if err != nil {
		return err
	}

	// The sandbox tier. One engine per install, and the worker is told which one, because it
	// attaches with that engine's client and the two must agree. Nothing here chooses for a
	// machine: naming the host engine is what makes a run unconfined.
	engineName := *sandboxEngine
	if engineName == "" {
		engineName = os.Getenv("ACORNFALL_SANDBOX_ENGINE")
	}
	if engineName == "host" && *sandboxState != "" {
		return errors.New("--sandbox-state belongs to the microsandbox engine; the host engine keeps no state")
	}
	engine, err := sandboxTier(ctx, dir, *sandboxState, engineName)
	if err != nil {
		return err
	}

	workspaces := control.NewWorkspaces(control.WorkspacesOptions{
		Home:          dir,
		UserHome:      userHome,
		GeneralPath:   general,
		WorkspacesDir: *workspacesDir,
		WorkerCommand: command,
		WorkerDir:     worker,
		Model:         *model,
		Sandbox:       engine,
		// Nesting is allowed unless refused: a workspace's sandbox nests when the
		// engine offers it and the machine can grant it, and boots without it otherwise.
		DisableVMNesting: *disableVMNesting,
	})
	if err := workspaces.Open(ctx); err != nil {
		return err
	}
	defer workspaces.Close()

	server := &http.Server{
		Addr:              *addr,
		Handler:           httpapi.RequireToken(httpapi.New(workspaces, web.Files).Handler(), guard),
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()

	// Listen explicitly so the line below reports the address that was actually bound: with
	// a port of 0 the configured address says nothing about where to reach it.
	listener, err := net.Listen("tcp", *addr)
	if err != nil {
		return err
	}
	bound := listener.Addr().String()
	log.Printf("acornfall listening on http://%s  home=%s", displayAddr(bound), dir)
	if guard != "" && !httpapi.IsLoopback(bound) {
		log.Printf("auth: token required; open http://%s/?token=%s", prettyAddr(bound), guard)
	} else if guard == "" && !httpapi.IsLoopback(bound) {
		log.Printf("auth: off (--insecure)")
	}
	if err := server.Serve(listener); err != nil && err != http.ErrServerClosed {
		return err
	}
	return nil
}

// sandboxTier builds the machine's sandbox tier, or returns nil when this run asks for none.
// Opening it installs nothing: the engine is fetched on the first workspace that needs it,
// so starting the gateway stays fast and a machine that cannot sandbox still runs everything
// else — with tools that refuse.
//
// ACORNFALL_NO_SANDBOX is that refusal on purpose, not a fallback: no engine is configured,
// nothing is installed or booted, and the worker's tools refuse. Tests use it so one command
// behaves the same on a machine with /dev/kvm and in CI, which auto-detecting did not.
func sandboxTier(ctx context.Context, home, state, engineName string) (*sandbox.Manager, error) {
	if os.Getenv("ACORNFALL_NO_SANDBOX") != "" {
		log.Printf("sandbox: disabled by ACORNFALL_NO_SANDBOX; commands and file tools will refuse")
		return nil, nil
	}
	driver, err := sandbox.Engine(home, state, engineName)
	if err != nil {
		return nil, err
	}
	engine, err := sandbox.Open(ctx, sandbox.Options{
		Home:   home,
		Log:    log.Printf,
		Driver: driver,
	})
	if err != nil {
		return nil, err
	}
	report := engine.Report()
	if problem := engine.Problem(); problem != nil {
		log.Printf("sandbox: %v", problem)
		log.Printf("sandbox: commands and file tools will refuse until this is fixed; tools never run on the host")
	}
	log.Printf("sandbox: engine %s %s, state %s", report.Engine, report.Version, report.StateDir)
	if !report.Isolated {
		log.Printf("sandbox: the host engine is not isolated: commands and file tools run with this user's own reach")
	}
	return engine, nil
}

func providers(argv []string) {
	flags := flag.NewFlagSet("provider", flag.ContinueOnError)
	dataDir := flags.String("data-dir", "", "data directory")
	if err := flags.Parse(argv); err != nil {
		return
	}
	args := flags.Args()
	if len(args) == 0 {
		fmt.Fprintln(os.Stderr, "usage: acornfall provider <list|add|remove>")
		os.Exit(2)
	}
	dir, err := resolveDataDir(*dataDir)
	if err != nil {
		log.Fatalf("acornfall: %v", err)
	}
	path := filepath.Join(dir, "credentials.json")
	switch args[0] {
	case "list":
		all := readCredentials(path)
		if len(all) == 0 {
			fmt.Println("no providers configured")
			return
		}
		for id, credential := range all {
			fmt.Printf("%-24s %s\n", id, credential.Type)
		}
	case "add":
		if len(args) < 3 {
			fmt.Fprintln(os.Stderr, "usage: acornfall provider add <provider> <api-key>")
			os.Exit(2)
		}
		all := readCredentials(path)
		all[args[1]] = credential{Type: "api_key", Key: args[2]}
		if err := writeCredentials(path, all); err != nil {
			log.Fatalf("acornfall: %v", err)
		}
		fmt.Printf("stored api key for %s\n", args[1])
	case "remove":
		if len(args) < 2 {
			fmt.Fprintln(os.Stderr, "usage: acornfall provider remove <provider>")
			os.Exit(2)
		}
		all := readCredentials(path)
		delete(all, args[1])
		if err := writeCredentials(path, all); err != nil {
			log.Fatalf("acornfall: %v", err)
		}
		fmt.Printf("removed %s\n", args[1])
	default:
		fmt.Fprintf(os.Stderr, "unknown provider command %q\n", args[0])
		os.Exit(2)
	}
}

// credential is the pi-ai api-key credential shape. Go never interprets other
// credential types; it only stores and returns them.
type credential struct {
	Type string `json:"type"`
	Key  string `json:"key,omitempty"`
}

func readCredentials(path string) map[string]credential {
	all := map[string]credential{}
	payload, err := os.ReadFile(path)
	if err != nil {
		return all
	}
	if err := json.Unmarshal(payload, &all); err != nil {
		log.Fatalf("acornfall: %s is not valid JSON: %v", path, err)
	}
	return all
}

func writeCredentials(path string, all map[string]credential) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}
	payload, err := json.MarshalIndent(all, "", "  ")
	if err != nil {
		return err
	}
	temp := path + ".tmp"
	if err := os.WriteFile(temp, append(payload, '\n'), 0o600); err != nil {
		return err
	}
	return os.Rename(temp, path)
}

// displayAddr turns a wildcard bind into something clickable.
func displayAddr(addr string) string {
	if strings.HasPrefix(addr, ":") {
		return "0.0.0.0" + addr
	}
	return addr
}

// prettyAddr prefers the machine's own hostname over a wildcard address, so the
// printed URL is the one a remote browser can actually use.
func prettyAddr(addr string) string {
	host, port, err := net.SplitHostPort(addr)
	if err != nil {
		return addr
	}
	if host == "" || host == "0.0.0.0" || host == "::" {
		if name, err := os.Hostname(); err == nil && name != "" {
			return net.JoinHostPort(name, port)
		}
		return net.JoinHostPort("localhost", port)
	}
	return net.JoinHostPort(host, port)
}

/*
workspaceCommand is the operator's way to point a workspace at a folder of their choosing.
The interface cannot do this: it creates workspaces inside the workspaces folder by name,
which is what keeps it inside one directory. This edits the registry directly, and the
gateway picks the change up on its next start.
*/
func workspaceCommand(argv []string) {
	flags := flag.NewFlagSet("workspace", flag.ContinueOnError)
	dataDir := flags.String("data-dir", "", "the acornfall folder")
	image := flags.String("image", "", "sandbox image for this workspace, e.g. golang:1.24 (default: "+sandbox.DefaultImage+")")
	network := flags.String("network", "", `sandbox network: "on" (default) or "off"`)
	if err := flags.Parse(argv); err != nil {
		return
	}
	args := flags.Args()
	if len(args) == 0 {
		fmt.Fprintln(os.Stderr, "usage: acornfall workspace <list|add|remove> [--image IMAGE] [--network on|off]")
		os.Exit(2)
	}
	if *network != "" && !control.ValidNetwork(*network) {
		fmt.Fprintln(os.Stderr, `acornfall: --network is "on" or "off"`)
		os.Exit(2)
	}
	dir, err := resolveDataDir(*dataDir)
	if err != nil {
		log.Fatalf("acornfall: %v", err)
	}
	path := filepath.Join(dir, "workspaces.json")
	registry, err := control.LoadRegistryFile(path)
	if err != nil {
		log.Fatalf("acornfall: %v", err)
	}

	switch args[0] {
	case "list":
		if len(registry.Workspaces) == 0 {
			fmt.Println("no workspaces registered")
			return
		}
		for _, workspace := range registry.Workspaces {
			marker := " "
			if workspace.General {
				marker = "*"
			}
			fmt.Printf("%s %-16s %-22s %s\n", marker, workspace.Name, sandboxLabel(workspace), workspace.Path)
		}
		fmt.Printf("\nworkspaces folder: %s\n", registry.WorkspacesDir)
	case "add":
		if len(args) < 2 {
			fmt.Fprintln(os.Stderr, "usage: acornfall workspace add <name> [folder] [--image IMAGE] [--network on|off]")
			os.Exit(2)
		}
		name := args[1]
		folder := name
		if len(args) > 2 {
			folder = args[2]
		}
		absolute, err := filepath.Abs(folder)
		if err != nil {
			log.Fatalf("acornfall: %v", err)
		}
		if info, err := os.Stat(absolute); err != nil || !info.IsDir() {
			log.Fatalf("acornfall: no folder at %s", absolute)
		}
		for _, workspace := range registry.Workspaces {
			if workspace.Name == name {
				log.Fatalf("acornfall: workspace %q already exists", name)
			}
		}
		registry.Workspaces = append(registry.Workspaces, control.Workspace{
			Name: name, Path: absolute, Title: name, Image: *image, Network: *network,
		})
		if err := control.SaveRegistryFile(registry); err != nil {
			log.Fatalf("acornfall: %v", err)
		}
		fmt.Printf("added %s at %s\n", name, absolute)
		fmt.Printf("sandbox: %s, network %s\n", imageLabel(*image), networkLabel(*network))
	case "remove":
		if len(args) < 2 {
			fmt.Fprintln(os.Stderr, "usage: acornfall workspace remove <name>")
			os.Exit(2)
		}
		kept := registry.Workspaces[:0]
		removed := false
		for _, workspace := range registry.Workspaces {
			if workspace.Name != args[1] {
				kept = append(kept, workspace)
				continue
			}
			if workspace.General {
				log.Fatalf("acornfall: the general workspace cannot be removed")
			}
			removed = true
		}
		if !removed {
			log.Fatalf("acornfall: no workspace %q", args[1])
		}
		registry.Workspaces = kept
		if err := control.SaveRegistryFile(registry); err != nil {
			log.Fatalf("acornfall: %v", err)
		}
		fmt.Printf("removed %s (its folder and history are untouched)\n", args[1])
	default:
		fmt.Fprintf(os.Stderr, "unknown workspace command %q\n", args[0])
		os.Exit(2)
	}
}

// sandboxLabel is what a workspace's sandbox will be, for the list column: short enough to
// scan, specific enough to answer "which image is this one running".
func sandboxLabel(workspace control.Workspace) string {
	image := workspace.Image
	if image == "" {
		image = sandbox.DefaultImage
	}
	network := "net on"
	if workspace.Network == control.NetworkOff {
		network = "net off"
	}
	return image + ", " + network
}

func imageLabel(image string) string {
	if image == "" {
		return "image " + sandbox.DefaultImage + " (default)"
	}
	return "image " + image
}

func networkLabel(network string) string {
	if network == control.NetworkOff {
		return "off"
	}
	return "on (default)"
}

func resolveDataDir(flagValue string) (string, error) {
	if flagValue != "" {
		return filepath.Abs(flagValue)
	}
	if env := os.Getenv("ACORNFALL_HOME"); env != "" {
		return filepath.Abs(env)
	}
	if env := os.Getenv("ACORNFALL_DATA"); env != "" {
		return filepath.Abs(env)
	}
	home, err := os.UserHomeDir()
	if err != nil {
		return "", err
	}
	return filepath.Join(home, ".acornfall"), nil
}

// resolveWorkerDir finds the worker package without requiring configuration.
func resolveWorkerDir(flagValue string) (string, error) {
	candidates := []string{flagValue, os.Getenv("ACORNFALL_WORKER"), "./worker", "../worker"}
	if executable, err := os.Executable(); err == nil {
		candidates = append(candidates, filepath.Join(filepath.Dir(executable), "..", "..", "worker"))
	}
	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		if _, err := os.Stat(filepath.Join(candidate, "src", "main.ts")); err == nil {
			return filepath.Abs(candidate)
		}
	}
	return "", fmt.Errorf("worker not found: pass --worker-dir or set ACORNFALL_WORKER")
}
