//go:build darwin

package sandbox

import (
	"os/exec"
	"strings"
)

// hostNestedSupport asks this machine whether a sandbox could nest: an Apple Silicon M3 or
// later, on macOS 15 or later, which is where hardware-assisted nested virtualization (EL2)
// exists. The engine's own check is the authority; this only decides where it is worth
// asking.
func hostNestedSupport() NestingSupport {
	brand, err := systemOutput("sysctl", "-n", "machdep.cpu.brand_string")
	if err != nil {
		return unavailable("cannot ask the machine about nesting: %v", err)
	}
	version, err := systemOutput("sw_vers", "-productVersion")
	if err != nil {
		return unavailable("cannot ask the machine about nesting: %v", err)
	}
	return nestedFromApple(brand, version)
}

// systemOutput runs a small system command for its one line of answer.
func systemOutput(name string, args ...string) (string, error) {
	output, err := exec.Command(name, args...).Output()
	if err != nil {
		return "", err
	}
	return strings.TrimSpace(string(output)), nil
}
