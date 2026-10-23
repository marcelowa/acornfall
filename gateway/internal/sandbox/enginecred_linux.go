//go:build linux

package sandbox

import (
	"os/exec"
	"syscall"
)

// runAsEngineOwner runs the engine as the folder's owner. The engine writes the machine's disk
// and serves the share; when the install created a fixed non-root owner, the engine must be that
// user or every file it creates belongs to root and the container cannot write it.
func runAsEngineOwner(command *exec.Cmd, uid, gid int) {
	if uid > 0 {
		command.SysProcAttr = &syscall.SysProcAttr{Credential: &syscall.Credential{Uid: uint32(uid), Gid: uint32(gid)}}
	}
}
