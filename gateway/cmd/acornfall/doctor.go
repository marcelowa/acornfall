package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"time"

	"github.com/acornfall/acornfall/gateway/internal/ready"
	"github.com/acornfall/acornfall/gateway/internal/sandbox"
	"github.com/acornfall/acornfall/gateway/internal/update"
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
	// Read the store through the pinned engine, so a catalog migrated forward by a
	// newer binary shows as a problem instead of a ready tier that refuses work.
	manager.Verify(context.Background())
	report := manager.Report()
	nesting := manager.Nesting(context.Background())
	updater := update.New(resolved, "", "")
	if err := updater.Open(); err != nil {
		log.Fatalf("acornfall doctor: %v", err)
	}
	// Preflight never blocks on the network: an offline machine still gets
	// every local answer, and the release check degrades to a sentence.
	checkCtx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	health := updater.Preflight(checkCtx)
	requirements := ready.Check(readyInput(resolved, updater, health, report, engineName))
	if *asJSON {
		// The report plus what the engine and the machine say about nesting: two answers,
		// because either half can refuse and the reason is worth reading.
		payload, err := json.MarshalIndent(struct {
			sandbox.Report
			Nesting sandbox.NestingSupport `json:"nesting"`
			Update  update.Preflight       `json:"update"`
			Ready   []ready.Requirement    `json:"readiness"`
		}{Report: report, Nesting: nesting, Update: health, Ready: requirements}, "", "  ")
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
		if nesting.Available {
			fmt.Printf("  nesting   yes\n")
		} else {
			fmt.Printf("  nesting   no (%s)\n", nesting.Reason)
		}
		if report.Problem != "" {
			fmt.Printf("  problem   %s\n", report.Problem)
			fmt.Println("\ntools will refuse until this is fixed; they do not run on the host")
		} else if !report.Isolated {
			fmt.Println("  ready     commands and file tools run on the host, unconfined")
		} else {
			fmt.Println("  ready     commands and file reads run inside the sandbox")
		}
		fmt.Println("update")
		fmt.Printf("  version   %s\n", health.Version)
		fmt.Printf("  worker    %s\n", health.Worker)
		fmt.Printf("  bun       %s\n", health.Bun)
		if health.Latest != "" {
			fmt.Printf("  releases  %s (latest)\n", health.Latest)
		} else {
			fmt.Printf("  releases  %s\n", health.Releases)
		}
		fmt.Println("readiness")
		for _, requirement := range requirements {
			if requirement.OK {
				fmt.Printf("  %-11s yes %s\n", requirement.Name, requirement.Detail)
				continue
			}
			fmt.Printf("  %-11s NO  %s\n", requirement.Name, requirement.Detail)
			fmt.Printf("  %-11s     fix: %s\n", "", requirement.Fix)
		}
	}
	if report.Problem != "" {
		os.Exit(1)
	}
}

// readyInput gathers what the readiness list reads from the managers
// doctor already owns. Report-only where possible: doctor changes nothing.
func readyInput(home string, updater *update.Manager, health update.Preflight, report sandbox.Report, engineName string) ready.Input {
	_, bunOK := updater.BunInstalled()
	return ready.Input{
		Home:            home,
		Current:         health.Version,
		RuntimeTag:      updater.RuntimeTag(),
		Worker:          updater.WorkerVersion(),
		BunPath:         updater.BunPath(),
		BunOK:           bunOK,
		EngineName:      report.Engine,
		EngineVersion:   report.Version,
		EngineInstalled: report.Installed,
		EngineIsolated:  report.Isolated,
		EngineProblem:   report.Problem,
		EngineDisabled:  disabledReason(),
		Latest:          health.Latest,
		ReleasesNote:    health.Releases,
		HasCredential:   ready.HasCredential(home),
	}
}

// disabledReason names an engine refusal from the environment, the way the
// gateway's own startup does: the same switch must mean the same thing.
func disabledReason() string {
	if os.Getenv("ACORNFALL_NO_SANDBOX") != "" {
		return "ACORNFALL_NO_SANDBOX is set"
	}
	return ""
}

// readyInputForBoot gathers the boot-time readiness list. The engine may
// be nil (refused tier): that is a stated answer, not a missing one.
func readyInputForBoot(home string, updates *update.Manager, engine *sandbox.Manager) ready.Input {
	_, bunOK := updates.BunInstalled()
	status := updates.Status()
	input := ready.Input{
		Home:          home,
		Current:       status.Current,
		RuntimeTag:    updates.RuntimeTag(),
		Worker:        updates.WorkerVersion(),
		BunPath:       updates.BunPath(),
		BunOK:         bunOK,
		HasCredential: ready.HasCredential(home),
		Latest:        status.Latest,
	}
	if engine == nil {
		input.EngineDisabled = disabledReason()
		if input.EngineDisabled == "" {
			input.EngineDisabled = "no engine configured"
		}
		return input
	}
	report := engine.Report()
	input.EngineName = report.Engine
	input.EngineVersion = report.Version
	input.EngineInstalled = report.Installed
	input.EngineIsolated = report.Isolated
	if problem := engine.Problem(); problem != nil {
		input.EngineProblem = problem.Error()
	}
	return input
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
