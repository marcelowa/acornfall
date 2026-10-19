package shim

import (
	"context"
	"net"
	"path/filepath"
	"testing"
	"time"
)

// The appliance's door: the gateway listens on a socket inside the same machine and the shim
// dials it. No vsock, no copy, no version to keep in step — the same protocol over a path.
func TestTheShimCanDialTheGatewayInTheSameMachine(t *testing.T) {
	door := filepath.Join(t.TempDir(), "shim.sock")
	listener, err := net.Listen("unix", door)
	if err != nil {
		t.Fatal(err)
	}
	defer listener.Close()
	server := &Server{Version: "test", Runner: &fakeRuntime{answers: map[string]string{"lxc-start --version": "6.0.4"}}, Log: t.Logf}
	go func() {
		conn, err := listener.Accept()
		if err != nil {
			return
		}
		if err := server.Serve(conn); err != nil {
			t.Logf("serve: %v", err)
		}
	}()
	conn, err := DialUnix(door)
	if err != nil {
		t.Fatal(err)
	}
	defer conn.Close()
	client := NewClient(conn)
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	hello, err := client.Hello(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if hello.Protocol != Protocol || hello.Runtime != "6.0.4" {
		t.Errorf("hello = %+v", hello)
	}
}
