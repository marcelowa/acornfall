# The container shim

How the gateway drives the container runtime that runs a workspace inside the machine
([ADR 0021](../adr/0021-workspaces-as-lxc-containers.md)). Code: `gateway/internal/shim` (the
protocol, the server, the client) and `acornfall shim` (the subcommand that runs it).

## Why it exists

The alternative is the engine's own exec — `msb exec <machine> -- lxc-start …` — and two things
were measured against it (`docs/engineering/lxc-spike.md`):

- **A killed attach leaves the command running inside the container.** Killing the process the
  engine started ends the attach; the work it started inside the container survives. That is the
  failure ADR 0012 built the SDK path to avoid, and it would come back with every aborted command
  a model changed its mind about.
- **Making a container is several steps whose failures are text.** An OCI rootfs, a written
  configuration, a parent folder for every mount target, an owned rootfs, id ranges the machine
  must allow. Read out of a shell's output, each one is a string to parse and a chance to
  misreport; done by one program, each is a sentence in a reply.

## The door

The shim runs inside the machine. It serves:

- `--stdio` — one connection on stdin and stdout. How the live test runs it, and how a person can
  speak the protocol by hand.
- `--socket <path>` (default `/run/acornfall-shim.sock`) — a unix socket inside the machine, one
  goroutine per connection, so two installs sharing a machine do not stop each other's commands.

The gateway reaches that socket through the engine: `msb create --vsock HOST_PATH:PORT` publishes
a host local-IPC endpoint on a guest vsock port, which is the machine-to-host door the engine
offers. **The direction of that door has not been verified on the pin yet** — it is the first
thing to check when the machine is wired to the shim, and until then the tests use a socket or a
pipe.

The shim is a subcommand of the same binary the gateway already ships: linux/amd64 and
linux/arm64 are two of the release's own platforms, and one binary cannot drift from itself. How
it gets *into* the machine — baked into the appliance image, or copied in by the gateway — is
still open; both work with the same artifact.

## The protocol

One JSON object per line, either direction, `gateway/internal/shim/shim.go` as its only Go
definition:

```json
{"id":7,"op":"create","payload":{"name":"acornfall-app-1234abcd","image":"debian:stable-slim","dir":"/var/lib/lxc/acornfall-app-1234abcd","config":"lxc.uts.name = …\n","binds":[{"source":"/home/me/work","target":"/home/me/work"}],"owner":1000,"group":1000}}
{"id":7,"kind":"result","result":{"name":"acornfall-app-1234abcd"}}
```

- **`id`** is the client's number for the call, and it is the handle for everything that outlives
  one message: an exec is named by the id of the request that started it, and a kill names it.
- **`op`** and **`payload`** are a request; **`kind`** and everything else are a reply. Kinds:
  `result`, `error`, `chunk` (an exec's output), `end` (an exec finished, with its exit code and
  whether it was stopped).
- **`protocol`** is a number, and both sides refuse a mismatch at the handshake: the shim may be
  older than the gateway that found it, and guessing is how a control plane does something nobody
  asked for.

| op | payload | result |
|---|---|---|
| `hello` | — | protocol, the shim's version, the runtime's version, the machine's id ranges |
| `list` | — | every container, with its state |
| `create` | name, image, dir, configuration, binds, owner | — (refuses a name that exists) |
| `start` / `stop` / `remove` | name | — (`remove` kills first: the runtime refuses to destroy a running container) |
| `exec` | name, argv, cwd, env, uid, gid | `chunk`s while it runs, then `end` |
| `kill` | the exec's id | whether anything was still running |

A command's environment is cleared and set explicitly: the machine's environment is not the
workspace's business. A working directory is applied by a shell that passes the argv as
parameters, so nothing in it is parsed twice. Output arrives as it is produced, and a kill reaches
the command's own process group — the thing the engine's exec cannot do.

The container's *configuration* is the gateway's: `sandbox.Container.LXCConfig` renders it from
the policy, and the shim applies it. Who owns LXC's spelling stays where the policy is.

## What the shim does that a shell would forget

Each of these was a failure in the spike before it was a step in `create`:

- the rootfs is chowned to the mapped uid, and the container's folder is made traversable by it,
  or an unprivileged container does not start;
- every mount target's parent folder is created inside the image, because the runtime makes only
  the leaf and skips the rest silently;
- a file mount gets a file, not a directory, for the same reason;
- the runtime's own log goes to the container's folder (`lxc.log.file`), so a start that fails
  leaves its reason beside the container instead of nowhere.
- an exec in a container that is not running is refused by name, and a `start` whose container is
  not running afterwards is a refusal too, not a success the next call discovers.

## Testing

- `make test` covers the protocol, the calls each op makes, the kill, and the refusals, against a
  faked runtime: no runtime, no kernel, no root.
- Live, in a machine that has the runtime and the id ranges (`root:100000:65536` in
  `/etc/subuid` and `/etc/subgid` — what the appliance image will carry):

  ```sh
  ACORNFALL_LXC=1 go test ./internal/shim -run Live -v
  ```

  It makes a container from a workspace image, starts it, runs a command as the workspace's user,
  writes in the share, kills a command and checks that it died while the container's init lived,
  and removes the container. Gated rather than a tier because the runtime is installed by hand
  today; it joins `make test-sandbox` when the appliance image makes it always true.

The worker's client — the second definition of this protocol, in TypeScript — arrives with the
worker's exec moving inside a container.
