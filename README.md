# Acornfall

A personal assistant platform: a Go gateway and control plane over a pluggable
agent harness.

```
web client ──HTTP+SSE──► gateway (Go) ──► control ──JSONL/stdio──► worker (bun, pi-durable)
```

The harness is a provider behind the worker protocol. Replacing it means writing
another worker, not changing the control plane.

## Layout

| Path | What |
|---|---|
| `docs/adr/` | Decisions. Read `0001-concepts.md` first. |
| `gateway/` | Go: transport edge, control plane, worker supervision, embedded client. |
| `worker/` | bun: the Harness, its registry (tools, skills), and credentials. |
| `gateway/web/` | Client. No build step: plain ES modules, served from the binary. |

## Requirements

- Go 1.24+
- bun 1.4+
- an API key for a supported provider (or the dev provider below)

## Run

```bash
make deps                      # bun install in worker/
make build                     # go build -> ./bin/acornfall

./bin/acornfall provider add opencode-go "$OPENCODE_API_KEY"
./bin/acornfall                 # http://127.0.0.1:7777 in a workspace directory
```

Useful flags: `--workspace <dir>`, `--data-dir <dir>` (default `~/.acornfall`),
`--model <provider>/<modelId>`, `--addr <host:port>`, `--worker-dir <dir>`.

### Without an API key

The dev provider answers every turn with one real `bash` call and a scripted
reply, so the whole path (tools, streaming, steering, usage) runs offline:

```bash
make dev
```

## What works

- Streaming transcript with tool cards, live tool output, and a running/idle indicator.
- **Steering**: type while a turn runs. The message queues visibly, then joins the
  running work after the current tool round.
- Abort, model switching, and per-turn usage.
- Crash resume: `kill` the worker and restart; the run continues from its last commit.
- Credentials live in `~/.acornfall/credentials.json` (0600), never in the worker's home.

## What does not exist yet

Memory, MCP, codemode, subagents, multi-session, multi-user, triggers, the resource
overlay compiler (`global → workspace → agent`), sandboxing beyond the host process,
and OAuth login flows. See `docs/adr/` for the designs they will land against.

## Development

```bash
make typecheck     # worker typecheck
make build         # gateway build
make dev           # dev provider + gateway, workspace = current directory
```

The worker protocol is defined once per language — `worker/src/protocol.ts` and
`gateway/internal/protocol/protocol.go` — and documented in `docs/adr/0002-layers-and-protocol.md`.
