// Package ready is the install's readiness list: every thing acornfall
// needs from a machine, each with a plain fix. Doctor prints it, boot
// logs what is missing. A missing piece is a sentence with a fix, never
// a crash and never a silent fallback.
//
// New dependencies land here: one Requirement, not a new special case in
// three places. Anything auto-installable (bun, worker sources, the
// engine) is ensured where it is used; this list only tells the truth.
package ready

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"syscall"

	"github.com/acornfall/acornfall/gateway/internal/update"
)

// Requirement is one thing the install needs: whether it holds, what it
// is in one line, and how to fix it when it does not.
type Requirement struct {
	Name   string `json:"name"`
	OK     bool   `json:"ok"`
	Detail string `json:"detail"`
	Fix    string `json:"fix"`
}

// Input is everything the checks read. The caller gathers it from the
// managers it already owns; this package decides nothing it cannot see.
type Input struct {
	Home string
	// Current is the running tag ("dev" for source builds).
	Current string
	// Worker is the ensured sources' tag, "" when none.
	Worker string
	// BunPath and BunOK say whether the pinned runtime answers.
	BunPath string
	BunOK   bool
	// Engine describes the sandbox tier; Disabled says it was refused.
	EngineName      string
	EngineVersion   string
	EngineInstalled bool
	EngineIsolated  bool
	EngineProblem   string
	EngineDisabled  string
	// Latest names the release check's answer, "" with ReleasesNote.
	Latest        string
	ReleasesNote  string
	HasCredential bool
}

// Satisfied reports whether every requirement holds.
func Satisfied(requirements []Requirement) bool {
	for _, requirement := range requirements {
		if !requirement.OK {
			return false
		}
	}
	return true
}

// Check builds the list. Filesystem reads stay under Home so tests run
// anywhere; /dev/kvm and disk space read the machine, which is the point.
func Check(input Input) []Requirement {
	return []Requirement{
		homeWritable(input.Home),
		bun(input),
		worker(input),
		engine(input),
		hypervisor(),
		credentials(input),
		disk(input.Home),
		releases(input),
	}
}

func homeWritable(home string) Requirement {
	dir := home
	created := "is writable"
	// Doctor must not create anything: a home that does not exist yet is
	// judged by its parent, which is where creation would happen.
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		dir = filepath.Dir(home)
		created = "will be created inside writable " + dir
	}
	probe := dir + "/.acornfall-writable"
	if err := os.WriteFile(probe, []byte("ok"), 0o600); err != nil {
		return Requirement{"home", false, "cannot write " + dir + ": " + err.Error(), "run with a writable --home"}
	}
	_ = os.Remove(probe)
	return Requirement{"home", true, home + " " + created, ""}
}

func bun(input Input) Requirement {
	if input.BunOK {
		return Requirement{"bun", true, input.BunPath + " answers " + update.BunVersion, ""}
	}
	if input.Current == "dev" {
		return Requirement{"bun", true, "dev build: system bun over repo sources", ""}
	}
	return Requirement{"bun", false, "pinned runtime missing", "first boot downloads it (needs network once)"}
}

func worker(input Input) Requirement {
	if input.Worker != "" {
		if input.Worker == input.Current || input.Current == "" {
			return Requirement{"worker", true, "sources " + input.Worker, ""}
		}
		return Requirement{"worker", false, "sources " + input.Worker + " do not match " + input.Current, "restart: boot activates the staged sources"}
	}
	if input.Current == "dev" {
		return Requirement{"worker", true, "dev build: repo sources", ""}
	}
	return Requirement{"worker", false, "no sources yet", "first boot fetches them (needs network once)"}
}

func engine(input Input) Requirement {
	if input.EngineDisabled != "" {
		return Requirement{"engine", true, "disabled: " + input.EngineDisabled, ""}
	}
	if input.EngineProblem != "" {
		return Requirement{"engine", false, input.EngineProblem, "see the sandbox section above; tools refuse until it is fixed"}
	}
	if !input.EngineInstalled {
		return Requirement{"engine", false, input.EngineName + " not installed", "open a workspace: the engine installs on first use (needs network once)"}
	}
	name := input.EngineName
	if input.EngineVersion != "" {
		name += " " + input.EngineVersion
	}
	if !input.EngineIsolated {
		return Requirement{"engine", true, name + " runs on the host, unconfined", ""}
	}
	return Requirement{"engine", true, name + " installed", ""}
}

func hypervisor() Requirement {
	if runtime.GOOS != "linux" {
		return Requirement{"hypervisor", true, "not applicable on " + runtime.GOOS, ""}
	}
	if _, err := os.Stat("/dev/kvm"); err != nil {
		return Requirement{"hypervisor", false, "no /dev/kvm", "run where KVM exists, or --sandbox-engine host (unconfined)"}
	}
	return Requirement{"hypervisor", true, "/dev/kvm present", ""}
}

func credentials(input Input) Requirement {
	if input.HasCredential {
		return Requirement{"credentials", true, "at least one provider stored", ""}
	}
	return Requirement{"credentials", false, "no provider stored", "acornfall provider add <provider> <key> (the dev provider needs none)"}
}

func disk(home string) Requirement {
	var stat syscall.Statfs_t
	if err := syscall.Statfs(home, &stat); err != nil {
		if err := syscall.Statfs(filepath.Dir(home), &stat); err != nil {
			return Requirement{"disk", true, "free space unreadable, assuming room", ""}
		}
	}
	free := uint64(stat.Bavail) * uint64(stat.Bsize)
	detail := fmt.Sprintf("%dM free", free>>20)
	const want = 100 << 20
	if free < want {
		return Requirement{"disk", false, detail, "free disk: backups, images, and dependencies live here"}
	}
	return Requirement{"disk", true, detail, ""}
}

func releases(input Input) Requirement {
	if input.Latest != "" {
		return Requirement{"releases", true, "latest is " + input.Latest, ""}
	}
	if input.ReleasesNote != "" {
		return Requirement{"releases", false, input.ReleasesNote, "checks retry hourly; offline is fine, updates wait"}
	}
	return Requirement{"releases", true, "not checked yet", ""}
}

// HasCredential reports whether the credentials file names a provider.
func HasCredential(home string) bool {
	return credentialCount(home) > 0
}

func credentialCount(home string) int {
	payload, err := os.ReadFile(home + "/credentials.json")
	if err != nil {
		return 0
	}
	var all map[string]any
	if err := json.Unmarshal(payload, &all); err != nil {
		return 0
	}
	return len(all)
}
