//go:build linux

package sandbox

import "os"

// hostNestedSupport asks this machine whether a sandbox could nest. Linux says it in the KVM
// module's own parameter: the virtualization CPU flag reaches a guest only when nested is
// on, because the runtime asks KVM for it and KVM masks it when the host is not configured
// for nesting. Turning it on is deliberate — `kvm_intel.nested=1` (kvm_amd defaults to on) —
// and this is where acornfall declines to ask rather than letting a sandbox fail to boot.
func hostNestedSupport() NestingSupport {
	return nestedFromKVMParameters(
		readFileIfPresent("/sys/module/kvm_intel/parameters/nested"),
		readFileIfPresent("/sys/module/kvm_amd/parameters/nested"),
	)
}

// readFileIfPresent is "" where the file is not: an absent parameter is an answer, and not
// one this check can read.
func readFileIfPresent(path string) string {
	content, err := os.ReadFile(path)
	if err != nil {
		return ""
	}
	return string(content)
}
