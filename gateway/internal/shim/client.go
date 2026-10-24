package shim

import (
	"bufio"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"sync"
	"time"
)

// Client is the gateway's side: one connection, many calls, and an exec that can be stopped
// while it runs. The shim sees one call per request; the client is only responsible for
// matching replies to requests and for turning a cancelled context into a kill inside the
// machine — which is the whole reason the shim exists (a killed attach leaves the command
// running).
type Client struct {
	conn    net.Conn
	writeMu sync.Mutex
	mu      sync.Mutex
	next    uint64
	calls   map[uint64]*pending
	err     error
	done    chan struct{}
}

// pending is one request's place for its replies.
type pending struct {
	// terminal carries the frame that ends the call: a result, an error, or an exec's end.
	terminal chan Message
	// chunks receives an exec's output. Nil for calls that produce none.
	chunks func(Message)
}

// NewClient wraps a connection that already reaches a shim: a socket, a pipe, or a test's pair.
func NewClient(conn net.Conn) *Client {
	client := &Client{conn: conn, calls: map[uint64]*pending{}, done: make(chan struct{})}
	go client.read()
	return client
}

// Close closes the connection. Every command still running in it is killed by the shim, which
// is what a connection's end means.
func (c *Client) Close() error { return c.conn.Close() }

// Closed is closed when the connection ends, for a caller that waits on it.
func (c *Client) Closed() <-chan struct{} { return c.done }

func (c *Client) read() {
	reader := bufio.NewReader(c.conn)
	for {
		line, err := reader.ReadBytes('\n')
		if len(line) > 0 {
			var message Message
			if err := unmarshal(line, &message); err == nil {
				c.deliver(message)
			}
		}
		if err != nil {
			c.finish(err)
			return
		}
	}
}

func (c *Client) deliver(message Message) {
	c.mu.Lock()
	current, ok := c.calls[message.ID]
	c.mu.Unlock()
	if !ok {
		// A reply to a call nobody waits for (a kill whose exec already ended, a call that gave
		// up) is not an error: dropping it keeps the connection usable.
		return
	}
	switch message.Kind {
	case KindChunk:
		if current.chunks != nil {
			current.chunks(message)
		}
	default:
		select {
		case current.terminal <- message:
		default:
		}
	}
}

func (c *Client) finish(err error) {
	c.mu.Lock()
	if c.err == nil {
		// A connection that ends without EOF is a failure; a close — ours or the shim's — is how
		// a connection normally ends, and the calls still waiting are told which it was.
		if errors.Is(err, io.EOF) || errors.Is(err, net.ErrClosed) {
			c.err = errors.New("shim: the connection closed")
		} else {
			c.err = fmt.Errorf("shim: the connection ended: %w", err)
		}
	}
	c.calls = map[uint64]*pending{}
	c.mu.Unlock()
	close(c.done)
}

// send writes one request and registers where its replies go.
func (c *Client) send(op string, payload any, chunks func(Message)) (uint64, *pending, error) {
	var raw []byte
	if payload != nil {
		encoded, err := marshal(payload)
		if err != nil {
			return 0, nil, err
		}
		raw = encoded
	}
	c.mu.Lock()
	if c.err != nil {
		err := c.err
		c.mu.Unlock()
		return 0, nil, err
	}
	c.next++
	id := c.next
	current := &pending{terminal: make(chan Message, 8), chunks: chunks}
	c.calls[id] = current
	c.mu.Unlock()

	line, err := encode(Message{ID: id, Op: op, Payload: raw})
	if err != nil {
		return 0, nil, err
	}
	c.writeMu.Lock()
	_, err = c.conn.Write(line)
	c.writeMu.Unlock()
	if err != nil {
		c.mu.Lock()
		delete(c.calls, id)
		c.mu.Unlock()
		return 0, nil, fmt.Errorf("shim: sending %s: %w", op, err)
	}
	return id, current, nil
}

func (c *Client) forget(id uint64) {
	c.mu.Lock()
	delete(c.calls, id)
	c.mu.Unlock()
}

// call runs a request that answers once, and decodes the answer into result.
func call[T any](c *Client, ctx context.Context, op string, payload any, result *T) error {
	id, current, err := c.send(op, payload, nil)
	if err != nil {
		return err
	}
	defer c.forget(id)
	select {
	case message := <-current.terminal:
		if message.Kind == KindError {
			return errors.New(message.Error)
		}
		if result != nil && len(message.Result) > 0 {
			return json.Unmarshal(message.Result, result)
		}
		return nil
	case <-ctx.Done():
		return ctx.Err()
	case <-c.done:
		return c.failure()
	}
}

func (c *Client) failure() error {
	c.mu.Lock()
	defer c.mu.Unlock()
	if c.err == nil {
		return errors.New("shim: the connection ended")
	}
	return c.err
}

// Hello is the handshake: what the shim is, and what the machine has. A protocol the client
// does not speak is refused here, because the alternative is misreading what comes next.
func (c *Client) Hello(ctx context.Context) (Hello, error) {
	var hello Hello
	if err := call(c, ctx, OpHello, nil, &hello); err != nil {
		return Hello{}, err
	}
	if hello.Protocol != Protocol {
		return hello, fmt.Errorf("shim: the machine speaks protocol %d and this build speaks %d", hello.Protocol, Protocol)
	}
	return hello, nil
}

// List is every container the machine knows.
func (c *Client) List(ctx context.Context) ([]Instance, error) {
	var result ListResult
	if err := call(c, ctx, OpList, nil, &result); err != nil {
		return nil, err
	}
	return result.Containers, nil
}

// Create makes a container: its rootfs from the image, its configuration, and the paths its
// mounts need. A container that already exists is refused rather than replaced.
func (c *Client) Create(ctx context.Context, payload CreatePayload) error {
	return call[NamePayload](c, ctx, OpCreate, payload, nil)
}

func (c *Client) Start(ctx context.Context, name string) error {
	return call[NamePayload](c, ctx, OpStart, NamePayload{Name: name}, nil)
}

// Stop stops a container by killing what is in it: measured, a graceful stop of an image whose
// init ignores the signal waits out the runtime's own 60-second timeout.
func (c *Client) Stop(ctx context.Context, name string) error {
	return call[NamePayload](c, ctx, OpStop, NamePayload{Name: name}, nil)
}

func (c *Client) Remove(ctx context.Context, name string) error {
	return call[NamePayload](c, ctx, OpRemove, NamePayload{Name: name}, nil)
}

// Exec runs a command in a running container, delivering its output as it arrives, and returns
// how it ended. A cancelled context kills the command inside the container — the shim's kill,
// not the connection's end — and the report says "killed" rather than inventing an exit code.
func (c *Client) Exec(ctx context.Context, payload ExecPayload, onChunk func(stream string, data []byte)) (Exit, error) {
	id, current, err := c.send(OpExec, payload, func(message Message) {
		if onChunk != nil && len(message.Data) > 0 {
			onChunk(message.Stream, message.Data)
		}
	})
	if err != nil {
		return Exit{}, err
	}
	defer c.forget(id)
	select {
	case message := <-current.terminal:
		return exitOf(message)
	case <-ctx.Done():
		// The caller gave up: stop the command where it runs, then wait for the shim's report so
		// the caller knows the command is really gone.
		return c.stopExec(id, current)
	case <-c.done:
		return Exit{}, c.failure()
	}
}

func (c *Client) stopExec(id uint64, current *pending) (Exit, error) {
	killCtx, cancel := context.WithTimeout(context.Background(), Timeout)
	defer cancel()
	var result KillResult
	_ = call(c, killCtx, OpKill, KillPayload{Target: id}, &result)
	grace := time.NewTimer(Timeout)
	defer grace.Stop()
	select {
	case message := <-current.terminal:
		return exitOf(message)
	case <-grace.C:
		return Exit{}, fmt.Errorf("shim: the command in the machine did not stop within %s", Timeout)
	case <-c.done:
		return Exit{}, c.failure()
	}
}

func exitOf(message Message) (Exit, error) {
	if message.Kind == KindError {
		return Exit{}, errors.New(message.Error)
	}
	exit := Exit{}
	if message.Exit != nil {
		exit.Code = *message.Exit
	}
	exit.Stopped = message.Stopped
	return exit, nil
}
