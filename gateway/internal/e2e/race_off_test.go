//go:build !race

package e2e

// raceEnabled is false for a plain `go test ./...`, which keeps the end-to-end suite runnable
// without a race-instrumented toolchain (it needs cgo).
const raceEnabled = false
