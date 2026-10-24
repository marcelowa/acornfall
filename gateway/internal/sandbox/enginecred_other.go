//go:build !linux

package sandbox

import "os/exec"

// runAsEngineOwner has nothing to do where the engine already runs as the user.
func runAsEngineOwner(*exec.Cmd, int, int, []uint32) {}
