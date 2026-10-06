//go:build !linux

package sandbox

// kvmHint is empty where there is no /dev/kvm to explain.
func kvmHint() string { return "" }
