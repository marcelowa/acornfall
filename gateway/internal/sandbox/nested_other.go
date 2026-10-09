//go:build !linux && !darwin

package sandbox

// hostNestedSupport is unknown where acornfall has no check. The refusal is the honest
// answer: a machine nobody asked is not a machine that can nest, and a sandbox that never
// gets the flag still boots.
func hostNestedSupport() NestingSupport {
	return unavailable("nested virtualization is not checked on this platform")
}
