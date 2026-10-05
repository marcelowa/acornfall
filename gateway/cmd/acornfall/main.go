package main

import (
	"context"
	"encoding/json"
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

	workspaces := control.NewWorkspaces(control.WorkspacesOptions{
		Home:          dir,
		GeneralPath:   general,
		WorkspacesDir: *workspacesDir,
		WorkerCommand: command,
		WorkerDir:     worker,
		Model:         *model,
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
	trusted := flags.Bool("trusted", false, "read this workspace's own agents, skills, commands, and rules")
	if err := flags.Parse(argv); err != nil {
		return
	}
	args := flags.Args()
	if len(args) == 0 {
		fmt.Fprintln(os.Stderr, "usage: acornfall workspace <list|add|remove>")
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
			trust := "untrusted"
			if workspace.Trusted {
				trust = "trusted  "
			}
			fmt.Printf("%s %-16s %s  %s\n", marker, workspace.Name, trust, workspace.Path)
		}
		fmt.Printf("\nworkspaces folder: %s\n", registry.WorkspacesDir)
	case "add":
		// Scanned by hand: Go's flag package stops at the first non-flag argument, so
		// `add <name> <folder> --trusted` would otherwise read as three positionals and a
		// flag that silently did nothing.
		positional := make([]string, 0, 2)
		for _, arg := range args[1:] {
			switch arg {
			case "--trusted", "-trusted":
				*trusted = true
			default:
				positional = append(positional, arg)
			}
		}
		if len(positional) < 2 {
			fmt.Fprintln(os.Stderr, "usage: acornfall workspace add <name> <folder> [--trusted]")
			os.Exit(2)
		}
		name, folder := positional[0], positional[1]
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
			Name: name, Path: absolute, Title: name, Trusted: *trusted,
		})
		if err := control.SaveRegistryFile(registry); err != nil {
			log.Fatalf("acornfall: %v", err)
		}
		fmt.Printf("added %s at %s (%s)\n", name, absolute, trustLabel(*trusted))
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

func trustLabel(trusted bool) string {
	if trusted {
		return "trusted"
	}
	return "untrusted"
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
