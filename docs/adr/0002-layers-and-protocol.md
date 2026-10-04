# ADR 0002 — Layers and protocol

Status: accepted
Date: 2026-10-04

## Layers

```
UI ──HTTP+SSE──► gateway ──► control ──JSONL/stdio──► worker
```

| Layer | Owns | Must not know |
|---|---|---|
| **UI** | Rendering state, sending intents. | workers, storage, providers, credentials |
| **Gateway** | Transport edge: auth (later), framing, attachments, cursors, backpressure, rate limits. | what an agent or workspace is |
| **Control** | Workspaces, sessions, model bindings, credentials, worker lifecycle, usage accounting. | how the loop works |
| **Worker** | The loop: Harness, registry, tools, execution env. | our database, the UI, credentials at rest beyond its store |

In v0, gateway and control are packages inside one Go binary. Splitting them into
separate processes later is a deployment change.

**Rule.** One protocol per hop. Control is the only layer that translates. The gateway
forwards frames it does not understand; the worker never learns about HTTP.

## Worker protocol

JSONL on stdin/stdout, one object per line, `\n`-framed. stderr is diagnostics only.

Commands (control → worker), each with a client-chosen `id`:

| Command | Payload | Response `data` |
|---|---|---|
| `describe` | — | `{ providers: [{id, name, authenticated, models: [{id, name, contextWindow}]}], capabilities }` |
| `open` | `{ conversationId?, agent: {provider, modelId, thinkingLevel?, instructions?} }` | `{ conversationId }` |
| `attach` | `{ conversationId, from? }` | `{ conversationId, seq }` then a `view` frame |
| `detach` | `{ conversationId }` | — |
| `prompt` | `{ conversationId, text, whenBusy?: "steer" \| "follow-up" \| "reject" }` | `{ submissionId, disposition }` |
| `abort` | `{ conversationId }` | — |
| `usage` | — | `UsageState` |
| `shutdown` | — | — |

Frames (worker → control, unprompted):

| Frame | Payload |
|---|---|
| `response` | `{ id, ok, data?, error? }` |
| `view` | `{ conversationId, seq, value }` — the whole committed view |
| `submission` | `{ conversationId, submissionId, status }` — terminal only |

**`view` sends the whole committed view, not operations.** Durable's `watch()` exists to
send operations for remote clients; v0 sends the value because it is small, always
consistent, and removes an entire class of bug. `seq` is monotonic per conversation and
is the only resumption cursor. Operations are a later optimization behind the same frame.

### Attachment and resume

The gateway holds no transcript. On connect, a client receives each attached session's
current `view` frame; afterwards it receives frames as they arrive. A client that
reconnects passes `from` (its last `seq`) and control asks the worker to re-emit the
current view. Nothing is replayed below `from` because the view is a complete value, not
a delta — resumption is therefore correct by construction.

### Backpressure

One writer goroutine per attachment; a slow client is dropped and re-synchronized with a
fresh `view` rather than blocking the worker reader. The worker's stdout is read
unconditionally and fanned out to in-memory attachment queues.

## HTTP surface (v0)

One workspace and one session (`root`) exist per process. Session-scoped paths
arrive with multi-session support; the frame shapes do not change when they do.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/state` | workspace, session, agent binding, provider/model catalog |
| `GET` | `/api/stream` | SSE: `state` once, then `frame` events |
| `POST` | `/api/messages` | `{text, whenBusy}` |
| `POST` | `/api/abort` | abort the running turn |
| `POST` | `/api/agent` | `{provider, modelId, thinkingLevel?, instructions?}` |
| `GET` | `/api/usage` | token and cost totals |

SSE, not WebSocket, for v0: commands are plain POSTs, the server→client direction is the
only streaming one, reconnect is built in, and there is no dependency. WebSocket arrives
when we need client→server streaming (voice, presence, collaborative cursors).

## Startup sequence

1. Control reads its data dir: workspaces, credentials, settings.
2. Control ensures a workspace exists for `--workspace` (default: cwd).
3. Control spawns one worker for that workspace: `bun worker/src/main.ts --workspace <path> --storage <data>/ws/<id>/session.sqlite --credentials <data>/credentials.json`.
4. Control calls `describe`, caches the provider/model catalog.
5. Control calls `open` for the root conversation and `attach`es to it.
6. Gateway serves the UI; the first client receives the current view immediately.

## Consequences

- No transcript store in Go. Session metadata in Go is a list of ids plus titles.
- Adding a worker capability is a command in this table and a `describe` flag. Adding a
  wire is never necessary: the same frame kinds carry everything.
- Harness replacement means a second worker binary speaking these 8 commands. Control
  does not change.
