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
	if len(os.Args) > 1 && os.Args[1] == "provider" {
		providers(os.Args[2:])
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
	workspace := flags.String("workspace", "", "workspace directory (default: current directory)")
	dataDir := flags.String("data-dir", "", "data directory (default: ~/.acornfall)")
	model := flags.String("model", "", "default model as provider/modelId")
	workerCommand := flags.String("worker", "", `worker command (default: "bun run src/main.ts")`)
	workerDir := flags.String("worker-dir", "", "worker directory")
	if err := flags.Parse(argv); err != nil {
		return err
	}

	dir, err := resolveDataDir(*dataDir)
	if err != nil {
		return err
	}
	if err := os.MkdirAll(dir, 0o700); err != nil {
		return err
	}
	workdir := *workspace
	if workdir == "" {
		workdir, err = os.Getwd()
		if err != nil {
			return err
		}
	}
	workdir, err = filepath.Abs(workdir)
	if err != nil {
		return err
	}
	worker, err := resolveWorkerDir(*workerDir)
	if err != nil {
		return err
	}

	command := []string{"bun", "run", "src/main.ts"}
	if *workerCommand != "" {
		command = strings.Fields(*workerCommand)
	}
	storage := filepath.Join(dir, "session.sqlite")
	credentials := filepath.Join(dir, "credentials.json")
	command = append(command,
		"--workspace", workdir,
		"--storage", storage,
		"--credentials", credentials,
	)

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	guard, err := httpapi.ResolveToken(*token, os.Getenv("ACORNFALL_TOKEN"), dir, *addr)
	if err != nil {
		return err
	}

	ctl := control.New(control.Options{
		Workspace:     workdir,
		DataDir:       dir,
		WorkerCommand: command,
		WorkerDir:     worker,
		Model:         *model,
		SettingsPath:  filepath.Join(dir, "settings.json"),
	})
	if err := ctl.Open(ctx); err != nil {
		return err
	}
	defer ctl.Close()

	server := &http.Server{
		Addr:              *addr,
		Handler:           httpapi.RequireToken(httpapi.New(ctl, web.Files).Handler(), guard),
		ReadHeaderTimeout: 10 * time.Second,
	}
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		_ = server.Shutdown(shutdownCtx)
	}()

	log.Printf("acornfall listening on http://%s  workspace=%s", displayAddr(*addr), workdir)
	if guard != "" {
		if !httpapi.IsLoopback(*addr) {
			log.Printf("guard: token required; open http://%s/?token=%s", prettyAddr(*addr), guard)
		}
	}
	if err := server.ListenAndServe(); err != nil && err != http.ErrServerClosed {
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
	_, port, err := net.SplitHostPort(addr)
	if err != nil {
		return addr
	}
	host, _, err := net.SplitHostPort(addr)
	if err != nil || host == "" || host == "0.0.0.0" || host == "::" {
		if name, err := os.Hostname(); err == nil && name != "" {
			return net.JoinHostPort(name, port)
		}
		return net.JoinHostPort("localhost", port)
	}
	return net.JoinHostPort(host, port)
}

func resolveDataDir(flagValue string) (string, error) {
	if flagValue != "" {
		return filepath.Abs(flagValue)
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
