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
`--model <provider>/<modelId>` (the initial default model), `--addr <host:port>`,
`--token <secret>`, `--worker-dir <dir>`.

### Reaching it from another machine

```bash
make dev                        # binds the tailnet address, no token
```

A non-loopback bind requires a token. When none is given with `--token` or
`ACORNFALL_TOKEN`, one is generated into `<data-dir>/token` (0600) and the startup line
prints the URL to open once:

```
guard: token required; open http://desktop:7777/?token=e62b…
```

That query parameter sets an HttpOnly cookie and redirects to `/`, so it does not linger
in the address bar. `Authorization: Bearer <token>` also works. EventSource cannot set
headers, which is why the cookie exists.

The more secure alternative when you already have SSH access — and the one to prefer if
the machine is on a network you do not control:

```bash
ssh -L 7777:127.0.0.1:7777 desktop
# then browse http://localhost:7777, no token, nothing exposed
```

### Without an API key

The dev provider answers every turn with one real `bash` call and a scripted
reply, so the whole path (tools, streaming, steering, usage) runs offline:

```bash
make dev
```

## What works

- **Multiple conversations** per workspace in the left rail, with a real id from the
  harness. Rename, branch, and delete from the rail; see
  [ADR 0005](docs/adr/0005-multi-conversation.md) and
  [ADR 0006](docs/adr/0006-conversation-lifecycle.md). Branches fork *before* a user
  turn and hand that message back to the composer for editing.
- **Delete is a tombstone**, not a row delete: storage is append-only, so a deleted
  conversation keeps its transcript and is restorable from the rail.
- Streaming transcript with tool cards, live tool output, and a running/idle indicator.
- **Steering**: type while a turn runs. The message queues visibly, then joins the
  running work after the current tool round.
- Abort, model switching, a thinking level populated from what the model actually
  supports, and per-turn usage.
- **A default model** for new conversations, settable from the UI. Conversations that
  never chose a model inherit it; conversations that did keep theirs. See
  [ADR 0007](docs/adr/0007-model-defaults.md).
- **Context inspector**: the prompt sections and tool schemas the last request was
  actually sent, estimated tokens per section, and what changed since the previous
  request.
- **Agent definitions** with a global/workspace/agent overlay, and an explain view
  showing which layer contributed what. See `docs/adr/0004-resource-overlay.md`.
- Provider connect/disconnect from the UI, 42 providers, 60+ models each where the key allows.
- Crash resume: `kill` the worker and restart; the run continues from its last commit.
- Credentials live in `~/.acornfall/credentials.json` (0600), never in the worker's home.

## Write an agent

`~/.acornfall/agents/<name>.md` (global) or `<workspace>/.acornfall/agents/<name>.md`
(workspace, shadows a global definition of the same name):

```markdown
---
name: researcher
description: Reads before it writes
thinking: medium
allow-tools: read, bash, skill
deny-tools: write, edit
---
You are a researcher. Read before you answer, and name the paths you relied on.
```

`config.json` in the same two locations carries defaults for every agent in scope:

```json
{ "defaults": { "instructions": "…", "denyTools": ["bash"] } }
```

Then pick the agent in the top bar. **Reload files** in the inspector re-reads them
without restarting anything. Resolution rules and their rationale are in
[ADR 0004](docs/adr/0004-resource-overlay.md).

## What does not exist yet

Memory, MCP, codemode, subagents, multi-user, triggers, versioned agent definitions,
renaming or deleting a conversation, forking from the UI, and sandboxing beyond the host
process. `docs/adr/` holds the designs they will land against.

## Development

```bash
make typecheck     # worker typecheck
make build         # gateway build
make dev           # dev provider + gateway, workspace = current directory
```

The worker protocol is defined once per language — `worker/src/protocol.ts` and
`gateway/internal/protocol/protocol.go` — and documented in `docs/adr/0002-layers-and-protocol.md`.
