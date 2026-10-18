//go:build !linux

package shim

import (
	"errors"
	"net"
)

// DialVSock is Linux-only: the shim runs inside the machine, and the machine is a Linux guest on
// every host acornfall supports. This build of the gateway still has to compile on macOS, where
// nothing calls it.
func DialVSock(int) (net.Conn, error) {
	return nil, errors.New("shim: the vsock door is Linux-only")
}
