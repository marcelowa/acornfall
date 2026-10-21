//go:build linux

package shim

import (
	"fmt"
	"net"
	"os"
	"syscall"
	"time"
	"unsafe"
)

// The vsock dialer, encoded by hand: the syscall package does not carry AF_VSOCK, and this
// build has no dependencies (gateway/go.mod is stdlib and nothing else). The kernel's
// struct sockaddr_vm is small and fixed, so it is written out here rather than pulling in a
// module for one struct.

const (
	// afVsock is AF_VSOCK: the address family the virtio-vsock device speaks.
	afVsock = 40
	// sockaddrVMSize is sizeof(struct sockaddr_vm).
	sockaddrVMSize = 16
)

// DialVSock connects to the gateway's published socket: the port the machine was created with
// (`msb create --vsock HOST_PATH:PORT`).
func DialVSock(port int) (net.Conn, error) {
	fd, err := syscall.Socket(afVsock, syscall.SOCK_STREAM|syscall.SOCK_CLOEXEC, 0)
	if err != nil {
		return nil, fmt.Errorf("shim: no vsock in this machine: %w", err)
	}
	address := sockaddrVM(port)
	_, _, errno := syscall.Syscall(syscall.SYS_CONNECT, uintptr(fd), uintptr(unsafe.Pointer(&address[0])), sockaddrVMSize)
	if errno != 0 {
		syscall.Close(fd)
		return nil, fmt.Errorf("shim: dialing the host's vsock port %d: %w", port, errno)
	}
	return &vsockConn{file: os.NewFile(uintptr(fd), "vsock"), fd: fd, port: port}, nil
}

// sockaddrVM is struct sockaddr_vm, byte for byte: family(2) reserved(2) port(4) cid(4)
// flags(1) zero(3), little-endian on the two platforms this ships for. Getting an offset wrong
// is a dial that times out with nobody answering, which is how the first version of this was
// found: it had the port two bytes early.
func sockaddrVM(port int) [sockaddrVMSize]byte {
	var address [sockaddrVMSize]byte
	address[0] = afVsock
	for i := range 4 {
		address[4+i] = byte(port >> (8 * i))
		address[8+i] = byte(hostCID >> (8 * i))
	}
	return address
}

// vsockConn is the socket as a connection, written out because Go's net package cannot wrap
// one: net.FileConn asks the kernel for the socket's address and an AF_VSOCK address is not a
// family it knows ("address family not supported by protocol"), which is how this was found.
// The deadlines are real setsockopt timeouts rather than no-ops, so nothing here lies about
// what it supports.
type vsockConn struct {
	file *os.File
	fd   int
	port int
}

func (c *vsockConn) Read(data []byte) (int, error)  { return c.file.Read(data) }
func (c *vsockConn) Write(data []byte) (int, error) { return c.file.Write(data) }
func (c *vsockConn) Close() error                   { return c.file.Close() }

func (c *vsockConn) LocalAddr() net.Addr  { return vsockAddr{} }
func (c *vsockConn) RemoteAddr() net.Addr { return vsockAddr{port: c.port} }

func (c *vsockConn) SetDeadline(deadline time.Time) error {
	if err := c.SetReadDeadline(deadline); err != nil {
		return err
	}
	return c.SetWriteDeadline(deadline)
}

func (c *vsockConn) SetReadDeadline(deadline time.Time) error {
	return setTimeout(c.fd, syscall.SO_RCVTIMEO, deadline)
}

func (c *vsockConn) SetWriteDeadline(deadline time.Time) error {
	return setTimeout(c.fd, syscall.SO_SNDTIMEO, deadline)
}

func setTimeout(fd, option int, deadline time.Time) error {
	timeout := syscall.NsecToTimeval(time.Until(deadline).Nanoseconds())
	if deadline.IsZero() {
		timeout = syscall.Timeval{}
	}
	return syscall.SetsockoptTimeval(fd, syscall.SOL_SOCKET, option, &timeout)
}

type vsockAddr struct{ port int }

func (a vsockAddr) Network() string { return "vsock" }
func (a vsockAddr) String() string {
	if a.port == 0 {
		return "vsock:any"
	}
	return fmt.Sprintf("vsock:%d", a.port)
}
