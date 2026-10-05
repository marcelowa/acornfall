//go:build race

package e2e

// raceEnabled follows the test run: `go test -race` sets this build constraint, and the
// gateway the suite spawns is then built with the detector too. It is a separate process, so
// the flag on the test binary alone does not reach it — which is the only place the control
// plane's shared state is actually exercised.
const raceEnabled = true
