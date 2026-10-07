package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"

	"github.com/acornfall/acornfall/gateway/internal/sandbox"
)

// doctorCommand reports what this machine can do, and changes nothing: the difference
// between a diagnosis and a repair is the whole point of running it.
func doctorCommand(argv []string) {
	flags := flag.NewFlagSet("doctor", flag.ContinueOnError)
	dataDir := flags.String("data-dir", "", "data directory")
	home := flags.String("home", "", "the acornfall folder (default: ~/.acornfall)")
	sandboxEngine := flags.String("sandbox-engine", "", "which engine to report: microsandbox (default) or host")
	asJSON := flags.Bool("json", false, "print the report as JSON")
	if err := flags.Parse(argv); err != nil {
		os.Exit(2)
	}
	dir := *home
	if dir == "" {
		dir = *dataDir
	}
	resolved, err := resolveDataDir(dir)
	if err != nil {
		log.Fatalf("acornfall doctor: %v", err)
	}

	engineName := *sandboxEngine
	if engineName == "" {
		engineName = os.Getenv("ACORNFALL_SANDBOX_ENGINE")
	}
	manager, err := reportManager(resolved, engineName)
	if err != nil {
		log.Fatalf("acornfall doctor: %v", err)
	}
	report := manager.Report()
	if *asJSON {
		payload, err := json.MarshalIndent(report, "", "  ")
		if err != nil {
			log.Fatalf("acornfall doctor: %v", err)
		}
		fmt.Println(string(payload))
	} else {
		fmt.Println("sandbox")
		engine := report.Engine
		if report.Version != "" {
			engine += " " + report.Version
		}
		fmt.Printf("  engine    %s\n", engine)
		if report.Path == "" {
			fmt.Printf("  installed %s\n", yesNo(report.Installed))
		} else {
			fmt.Printf("  installed %s (%s)\n", yesNo(report.Installed), report.Path)
		}
		if report.StateDir != "" {
			fmt.Printf("  state     %s\n", report.StateDir)
		}
		fmt.Printf("  isolated  %s\n", yesNo(report.Isolated))
		if report.Problem != "" {
			fmt.Printf("  problem   %s\n", report.Problem)
			fmt.Println("\ntools will refuse until this is fixed; they do not run on the host")
		} else if !report.Isolated {
			fmt.Println("  ready     commands and file tools run on the host, unconfined")
		} else {
			fmt.Println("  ready     commands and file reads run inside the sandbox")
		}
	}
	if report.Problem != "" {
		os.Exit(1)
	}
}

// reportManager builds the report-only manager doctor describes. It has to name an engine:
// without a driver, Open refuses ("sandbox: Driver is required") and doctor can only report
// that failure, never the tier it exists to diagnose.
func reportManager(home, engineName string) (*sandbox.Manager, error) {
	driver, err := sandbox.Engine(home, "", engineName)
	if err != nil {
		return nil, err
	}
	return sandbox.Open(context.Background(), sandbox.Options{
		Home:       home,
		Driver:     driver,
		ReportOnly: true,
	})
}

func yesNo(value bool) string {
	if value {
		return "yes"
	}
	return "no"
}
