// The door: how the gateway reaches the shim inside the machine.
//
// The engine publishes a host local-IPC endpoint on a guest-to-host vsock port
// (`msb create --vsock HOST_PATH:PORT`): the gateway listens on a unix socket on the host, and
// the guest dials out to it. So the shim dials and the gateway accepts, and that one connection
// carries calls both ways — which also means the shim reconnects by itself when the gateway
// restarts, instead of waiting to be found.
//
// The dialer itself is per platform (door_linux.go, door_other.go): AF_VSOCK is a Linux device,
// and the syscall package does not carry it.
package shim

import (
	"errors"
	"fmt"
	"net"
	"syscall"
	"time"
)

// hostCID is the host as a guest sees it: the virtio-vsock specification's VMADDR_CID_HOST.
const hostCID = 2

// ServeVSock dials the host and serves that connection, and keeps doing it: a gateway that
// restarts, or that comes up after the machine, is a connection the shim makes again rather than
// a machine somebody has to restart. Waiting is for a door that is not there *yet*; a machine
// without the device at all is a refusal, because retrying forever would hide from whoever has
// to fix it that nothing will ever connect.
func (s *Server) ServeVSock(port int) error {
	for {
		conn, err := DialVSock(port)
		if err != nil {
			if !isRetryable(err) {
				return err
			}
			s.log("shim: %v; trying again in a second", err)
			time.Sleep(time.Second)
			continue
		}
		s.log("shim: connected to the host on vsock port %d", port)
		if err := s.Serve(conn); err != nil {
			s.log("shim: the connection ended: %v", err)
		}
	}
}

// isRetryable says whether the door is not there yet rather than not there at all: a listener
// that has not started, a host still coming up.
func isRetryable(err error) bool {
	return errors.Is(err, syscall.ECONNREFUSED) || errors.Is(err, syscall.ETIMEDOUT) || errors.Is(err, syscall.EAGAIN)
}

// ServeDialer serves whatever connection a dialer gives it, and keeps asking: the same loop as
// the vsock door, for a door that is a unix socket. That is the appliance's shape — the gateway
// and the shim live in the same machine (ADR 0022), so the "door" is a socket in its own
// filesystem and there is nothing to publish and nothing to copy in.
func (s *Server) ServeDialer(dial func() (net.Conn, error)) error {
	for {
		conn, err := dial()
		if err != nil {
			if !isRetryable(err) {
				return err
			}
			s.log("shim: %v; trying again in a second", err)
			time.Sleep(time.Second)
			continue
		}
		if err := s.Serve(conn); err != nil {
			s.log("shim: the connection ended: %v", err)
		}
	}
}

// DialUnix connects to the gateway's socket inside the same machine.
func DialUnix(path string) (net.Conn, error) {
	conn, err := net.Dial("unix", path)
	if err != nil {
		return nil, fmt.Errorf("shim: cannot reach the gateway at %s: %w", path, err)
	}
	return conn, nil
}
