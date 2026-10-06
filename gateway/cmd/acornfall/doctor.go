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

	manager, err := reportManager(resolved)
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
		fmt.Printf("  engine    %s %s\n", report.Engine, report.Version)
		fmt.Printf("  installed %s (%s)\n", yesNo(report.Installed), report.Path)
		fmt.Printf("  state     %s\n", report.StateDir)
		if report.Problem != "" {
			fmt.Printf("  problem   %s\n", report.Problem)
			fmt.Println("\ntools will refuse until this is fixed; they do not run on the host")
		} else {
			fmt.Println("  ready     commands and file reads run inside the sandbox")
		}
	}
	if report.Problem != "" {
		os.Exit(1)
	}
}

// reportManager builds the report-only manager doctor describes. It has to name the engine:
// without a driver, Open refuses ("sandbox: Driver is required") and doctor can only report
// that failure, never the tier it exists to diagnose.
func reportManager(home string) (*sandbox.Manager, error) {
	return sandbox.Open(context.Background(), sandbox.Options{
		Home:       home,
		Driver:     sandbox.NewMicrosandbox(home),
		ReportOnly: true,
	})
}

func yesNo(value bool) string {
	if value {
		return "yes"
	}
	return "no"
}
