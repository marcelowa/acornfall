package sandbox

import (
	"fmt"
	"regexp"
	"strconv"
	"strings"
)

// NestingSupport says whether a sandbox on this machine could nest virtual machines — run a
// hypervisor inside the sandbox, which is what developing one looks like from the inside.
//
// It is a capability, not a policy: whether any workspace asks for nesting is the policy's
// business, and the two have to agree before the engine is told anything. Reason says why
// not when Available is false, in a sentence fit for doctor and the state frame.
type NestingSupport struct {
	Available bool   `json:"available"`
	Reason    string `json:"reason,omitempty"`
}

// unavailable is the shape every refusal takes.
func unavailable(reason string, args ...any) NestingSupport {
	return NestingSupport{Reason: fmt.Sprintf(reason, args...)}
}

// kvmParameterEnabled reads one `nested` parameter the way its module writes it: kvm_intel
// prints a bool (Y/N), kvm_amd prints an int (1/0). Anything else is unknown.
func kvmParameterEnabled(value string) (enabled, known bool) {
	switch strings.TrimSpace(value) {
	case "Y", "y", "1":
		return true, true
	case "N", "n", "0":
		return false, true
	}
	return false, false
}

// nestedFromKVMParameters decides from what /sys/module/kvm_intel/parameters/nested and
// kvm_amd's say. An empty string is a file that is not there.
func nestedFromKVMParameters(intel, amd string) NestingSupport {
	var disabled []string
	for _, parameter := range []struct{ module, value string }{
		{"kvm_intel", intel},
		{"kvm_amd", amd},
	} {
		enabled, known := kvmParameterEnabled(parameter.value)
		if !known {
			continue
		}
		if enabled {
			return NestingSupport{Available: true}
		}
		disabled = append(disabled, parameter.module)
	}
	if len(disabled) > 0 {
		return unavailable(
			"the host kernel has nested virtualization off (%s.nested=0): turn it on and restart",
			strings.Join(disabled, ", "),
		)
	}
	return unavailable("the host kernel does not report nested virtualization support")
}

// appleNestedPattern matches the chips that can nest: Apple's hardware-assisted nested
// virtualization (FEAT_NV2) arrived with the M3.
var appleNestedPattern = regexp.MustCompile(`^Apple M(\d+)`)

// nestedFromApple decides from the CPU brand and the OS version: nested virtualization needs
// an Apple Silicon M3 or later, running macOS 15 (Sequoia) or later.
func nestedFromApple(brand, version string) NestingSupport {
	chip := appleNestedPattern.FindStringSubmatch(strings.TrimSpace(brand))
	if chip == nil {
		return unavailable("nested virtualization needs an Apple Silicon M3 or later, and this machine reports %q", strings.TrimSpace(brand))
	}
	generation, err := strconv.Atoi(chip[1])
	if err != nil || generation < 3 {
		return unavailable("nested virtualization needs an Apple Silicon M3 or later")
	}
	major, err := strconv.Atoi(strings.SplitN(strings.TrimSpace(version), ".", 2)[0])
	if err != nil {
		return unavailable("cannot tell the macOS version from %q; nested virtualization needs macOS 15 or later", version)
	}
	if major < 15 {
		return unavailable("nested virtualization needs macOS 15 or later, and this machine reports %s", version)
	}
	return NestingSupport{Available: true}
}
