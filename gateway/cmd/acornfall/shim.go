package main

import (
	"flag"
	"io"
	"log"
	"net"
	"os"

	"github.com/acornfall/acornfall/gateway/internal/shim"
	"github.com/acornfall/acornfall/gateway/internal/update"
)

// shimCommand runs the container shim inside the machine: the gateway's hands for the container
// runtime. It is part of the same binary on purpose — a release already ships linux/amd64 and
// linux/arm64, which are the machine's two platforms, and one binary cannot drift from itself —
// and it is a subcommand rather than a second program so there is no second artifact to build,
// pin, and keep in step with the image. See docs/engineering/container-shim.md.
func shimCommand(argv []string) {
	flags := flag.NewFlagSet("acornfall shim", flag.ContinueOnError)
	socket := flags.String("socket", "/run/acornfall-shim.sock", "unix socket to listen on inside the machine")
	pipe := flags.Bool("stdio", false, "serve one connection on stdin and stdout instead of a socket")
	vsock := flags.Int("vsock", 0, "dial the host on this vsock port and serve the connection (the door the engine publishes)")
	connect := flags.String("connect", "", "dial this unix socket and serve the connection (the appliance, where the gateway is in the same machine)")
	if err := flags.Parse(argv); err != nil {
		os.Exit(2)
	}
	server := &shim.Server{Version: update.BuildVersion, Log: log.Printf}
	if *vsock > 0 {
		if err := server.ServeVSock(*vsock); err != nil {
			log.Fatalf("acornfall shim: %v", err)
		}
		return
	}
	if *connect != "" {
		// ServeDialer keeps asking: it returns only when the connection failed for a reason asking
		// again will not fix.
		log.Fatalf("acornfall shim: %v", server.ServeDialer(func() (net.Conn, error) { return shim.DialUnix(*connect) }))
	}
	if *pipe {
		if err := server.Serve(stdio{reader: os.Stdin, writer: os.Stdout}); err != nil {
			log.Fatalf("acornfall shim: %v", err)
		}
		return
	}
	// A socket left behind by the last boot is not a listener: unlinking it is what makes a
	// fresh start possible without a person noticing the old one.
	if err := os.Remove(*socket); err != nil && !os.IsNotExist(err) {
		log.Fatalf("acornfall shim: %v", err)
	}
	listener, err := net.Listen("unix", *socket)
	if err != nil {
		log.Fatalf("acornfall shim: %v", err)
	}
	log.Printf("acornfall shim: listening on %s (protocol %d)", *socket, shim.Protocol)
	for {
		conn, err := listener.Accept()
		if err != nil {
			log.Fatalf("acornfall shim: %v", err)
		}
		// One goroutine per connection: two installs may share a machine, and one of them
		// closing its connection must not stop the other's commands.
		go func() {
			if err := server.Serve(conn); err != nil {
				log.Printf("acornfall shim: %v", err)
			}
		}()
	}
}

// stdio is the shim's other door: a pipe. It is how the protocol is exercised without the
// engine's socket in the way, and how the live test runs a real shim as a child process.
type stdio struct {
	reader io.Reader
	writer io.Writer
}

func (s stdio) Read(data []byte) (int, error)  { return s.reader.Read(data) }
func (s stdio) Write(data []byte) (int, error) { return s.writer.Write(data) }
func (s stdio) Close() error                   { return nil }
