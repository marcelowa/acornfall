// Package shim is the container layer's hands inside the machine: the LXC work a workspace
// needs, done by one small program that the gateway speaks to over one connection.
//
// Why it exists at all, measured (docs/engineering/lxc-spike.md, docs/adr/0021): the
// alternative is the engine's own exec — `msb exec <machine> -- lxc-start …` — and that leaves
// a killed command running inside its container, because the engine kills the attach and not
// the work. It also turns a container's creation into a sequence of shell commands whose
// failures have to be read out of text. So the work lives here: one connection, one program
// that owns the container's process trees and reports what happened as data.
//
// This file is the protocol, and it is the only definition of it in Go: the gateway's client
// and the shim's server share these types, so a change cannot half-land. The worker's side is
// a second definition in TypeScript, and the rule in docs/engineering/standards.md (S6) is
// what keeps the two in step.
package shim

import (
	"encoding/json"
	"fmt"
	"time"
)

// Protocol is the wire version, bumped when a message changes shape. A shim and a gateway that
// do not agree refuse each other: the shim may be delivered by the image or copied in by a
// gateway, so the two versions can differ, and guessing is how a control plane does something
// nobody asked for.
const Protocol = 1

// Operations. A request carries one, with a payload for the ones that need it.
const (
	OpHello  = "hello"  // versions and what this machine has
	OpList   = "list"   // every container the machine knows
	OpCreate = "create" // make a container's rootfs and write its configuration
	OpStart  = "start"  // boot a container
	OpStop   = "stop"   // stop a container, killing what is in it
	OpRemove = "remove" // delete a container and everything in it
	OpExec   = "exec"   // run a command in a running container
	OpKill   = "kill"   // stop a running exec, killing the command inside the container
)

// Message kinds the server sends. A request is Op plus Payload; every response has the ID of
// the request it answers.
const (
	KindResult = "result" // the call finished; Result holds what it produced
	KindError  = "error"  // the call failed; Error is a sentence for a person
	KindChunk  = "chunk"  // one piece of an exec's output
	KindEnd    = "end"    // an exec finished; Exit and Stopped say how
)

// Message is one line of the protocol, in either direction. Requests name an op and carry a
// payload; responses name a kind. One type for both directions keeps the framing in one place.
type Message struct {
	// ID is the client's number for the call. An exec's kill names the exec's ID, so IDs are
	// the handle for everything that outlives a single message.
	ID uint64 `json:"id"`
	// Op is set on a request; Kind on a response.
	Op   string `json:"op,omitempty"`
	Kind string `json:"kind,omitempty"`
	// Payload is the request's arguments, and Result the response's value. Both are decoded
	// into the types below by the op that names them.
	Payload json.RawMessage `json:"payload,omitempty"`
	Result  json.RawMessage `json:"result,omitempty"`
	// Error is a refusal or a failure, in a sentence. It is never empty when a call failed:
	// a client that has to invent a reason is a client that will invent the wrong one.
	Error string `json:"error,omitempty"`
	// Stream, Data, Exit and Stopped belong to an exec: its output arrives as chunks, and the
	// end of it says the code, and "killed" when it was stopped rather than finished.
	Stream  string `json:"stream,omitempty"`
	Data    []byte `json:"data,omitempty"`
	Exit    *int   `json:"exit,omitempty"`
	Stopped string `json:"stopped,omitempty"`
}

// Hello is what the shim can do here, and with what.
type Hello struct {
	Protocol int    `json:"protocol"`
	Version  string `json:"version,omitempty"`
	// Runtime is the container runtime's own version, empty when it is not installed. A
	// machine without it is a machine that cannot run a workspace, and saying so once at the
	// handshake is better than failing on the first create.
	Runtime string `json:"runtime,omitempty"`
	// IDs is the uid range this machine may map for unprivileged containers, read from
	// /etc/subuid. Empty means the machine cannot make one.
	IDs string `json:"ids,omitempty"`
}

// Instance is one container as the runtime reports it.
type Instance struct {
	Name   string `json:"name"`
	Status string `json:"status"`
	// Running is the runtime's own word, resolved here so that every caller does not compare
	// strings in its own way.
	Running bool `json:"running"`
	// Problem is why this container's state could not be read. A container that is there and
	// unreadable is still a fact about the machine, and one of them used to fail the whole list
	// call: every workspace lost its tools while its own container was RUNNING (measured).
	Problem string `json:"problem,omitempty"`
}

// ListResult is every container the machine knows.
type ListResult struct {
	Containers []Instance `json:"containers"`
}

// CreatePayload is a workspace's container as the gateway decided it: what it is made of, where
// it lives, and the configuration it runs under. The gateway renders the configuration
// (sandbox.Container.LXCConfig) because the policy is the gateway's business; the shim applies
// it, makes the rootfs, and prepares the paths the mounts need.
type CreatePayload struct {
	Name  string `json:"name"`
	Image string `json:"image"`
	// Dir is the container's own folder inside the machine: the runtime's layout, with the
	// config beside the image blobs and the rootfs at <Dir>/rootfs.
	Dir string `json:"dir"`
	// Config is the container's configuration, as the runtime reads it.
	Config string `json:"config"`
	// Binds are the host paths the container will see. Their targets have to exist inside the
	// rootfs before it starts: the runtime makes the leaf and skips a target whose parent is
	// not there, silently (measured). Source is a path in the machine, Target the path inside
	// the container.
	Binds []Bind `json:"binds,omitempty"`
	// Owner is the uid that owns the created bind targets, for an unprivileged container: a
	// target its root cannot write is a mount it cannot use. Zero leaves them as root's.
	Owner int `json:"owner,omitempty"`
	// Group is the gid for Owner.
	Group int `json:"group,omitempty"`
	// RootfsOwner and RootfsGroup are who owns the rootfs itself: the *mapped* uid for an
	// unprivileged container, not the share's owner. Get it wrong and the container starts and
	// then cannot write its own filesystem — an image's package manager is the first thing to
	// find out. Zero leaves the rootfs as the image made it.
	RootfsOwner int `json:"rootfsOwner,omitempty"`
	RootfsGroup int `json:"rootfsGroup,omitempty"`
	// Home is the workspace, and becomes the home folder of the passwd entry the container is
	// given for the share's owner. Empty is "/": an entry is needed for the uid, not for the
	// folder, and a container with no home is worse than one with the wrong home.
	Home string `json:"home,omitempty"`
	// Network is the network this container joins, or nil for none at all. It is the engine's
	// choice and the shim's to make real: the bridge, its address and its way out of the machine
	// are made here, once, before the first container that wants them starts.
	Network *NetworkPayload `json:"network,omitempty"`
}

// Bind is one mount's two ends, enough for the shim to prepare the target.
type Bind struct {
	Source string `json:"source"`
	Target string `json:"target"`
	File   bool   `json:"file,omitempty"`
}

// NamePayload is the argument of start, stop and remove.
type NamePayload struct {
	Name string `json:"name"`
}

// ExecPayload is one command to run in a container.
type ExecPayload struct {
	Name string   `json:"name"`
	Argv []string `json:"argv"`
	// Cwd is where the command starts. The runtime has no such option, so the shim runs the
	// command through a shell that changes directory first — with the argv passed as parameters,
	// so nothing in it is parsed twice.
	Cwd string `json:"cwd,omitempty"`
	// Env is the environment the command gets, and nothing else: the shim clears what the
	// attach would otherwise inherit from the machine, because a machine's environment leaking
	// into a workspace is how two workspaces become one.
	Env []string `json:"env,omitempty"`
	// UID and GID run the command as that user inside the container. Zero means the container's
	// own root, which for an unprivileged container is the mapped uid — files it writes in the
	// share would then belong to nobody. A workspace's commands run as the user.
	UID int `json:"uid,omitempty"`
	GID int `json:"gid,omitempty"`
}

// KillPayload names a running exec by the ID of the request that started it.
type KillPayload struct {
	Target uint64 `json:"target"`
}

// Exit is how an exec ended.
type Exit struct {
	Code int `json:"code"`
	// Stopped is empty for a command that finished, and "killed" for one the shim stopped.
	Stopped string `json:"stopped,omitempty"`
}

// Timeout bounds a call that should not hang: a container command is not under it, because a
// command may legitimately take as long as it takes. The client's own context is the bound for
// those.
const Timeout = 30 * time.Second

// encode marshals one message as a line. Shared by both sides so the framing cannot differ.
func encode(message Message) ([]byte, error) {
	line, err := json.Marshal(message)
	if err != nil {
		return nil, err
	}
	return append(line, '\n'), nil
}

// decodeError turns a decoding failure into a refusal that names the protocol.
func decodeError(err error) error {
	return fmt.Errorf("shim: cannot read a protocol message (protocol %d): %w", Protocol, err)
}

// KillResult answers a kill: whether an exec was found. A kill that arrives after its command
// finished is not a failure, and the caller cannot tell the two apart by itself.
type KillResult struct {
	Killed bool `json:"killed"`
}

func marshal(value any) (json.RawMessage, error) {
	data, err := json.Marshal(value)
	if err != nil {
		return nil, fmt.Errorf("shim: cannot encode a protocol value: %w", err)
	}
	return data, nil
}

func unmarshal(line []byte, message *Message) error {
	return json.Unmarshal(line, message)
}

func unmarshalPayload[T any](message Message) (T, error) {
	var payload T
	if len(message.Payload) == 0 {
		return payload, fmt.Errorf("shim: %s needs a payload", message.Op)
	}
	if err := json.Unmarshal(message.Payload, &payload); err != nil {
		return payload, fmt.Errorf("shim: cannot read the %s payload: %w", message.Op, err)
	}
	return payload, nil
}
