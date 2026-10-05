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
| `tools/` | Browser-driven checks. |

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
`--model <provider>/<modelId>` (the last resort's first choice), `--addr <host:port>`,
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
- **Every pane is timestamped**, and a conversation header says whether it is working,
  when it last did, and what it has cost.
- **A conversation lives in the URL** (`/c/1276`), so several browser tabs can show
  different conversations at once, a reload lands where you were, and links are shareable.
  See [ADR 0010](docs/adr/0010-per-tab-attachments.md).
- **Formatted replies**: assistant text renders as Markdown (headings, lists, tables,
  fenced code, links) with a toggle back to the raw text. Tool output stays monospace
  with terminal escape codes stripped.
- **Steering**: type while a turn runs. The message queues visibly, then joins the
  running work after the current tool round.
- Abort, model switching, a thinking level populated from what the model actually
  supports, and per-turn usage.
- **Defaults** for model, thinking level, and agent, settable from the settings sheet for
  this workspace or for every one. A conversation that chose keeps its choice, a definition
  that names a model or level beats both, and below them the install default applies — and
  when nothing is set anywhere, a preferred model rather than whichever happens to be listed
  first. See [ADR 0007](docs/adr/0007-model-defaults.md).
- **Context inspector**: the prompt sections and tool schemas the last request was
  actually sent, estimated tokens per section, and what changed since the previous
  request.
- **Agent definitions** with a global/workspace/agent overlay, and an explain view
  showing which layer contributed what. See `docs/adr/0004-resource-overlay.md`.
- **Workspaces**: a folder, its own `AGENTS.md`, config, agents, skills, and commands, and
  a trust decision that decides whether any of it is read. Each workspace runs its own
  worker and storage, started on first use. See `docs/adr/0011-workspaces.md`.
- **Slash commands** from `<home>/commands/` and `<workspace>/.acornfall/commands/`,
  expanded server-side so the transcript records what the model saw.
- **Guards**: declarative rules that block a tool call and say why — a command pattern, or a
  path outside the workspace — accumulating across layers and visible in the inspector.
- **Workspaces are managed from the interface**: create by name inside the workspaces folder
  (`--workspaces-dir`, default `~/acornfall/workspaces`), flip trust, forget one (which never
  deletes the folder or the history). Pointing a workspace at a folder elsewhere is
  `acornfall workspace add <name> <folder>`, because the interface stays inside one
  directory.
- **Delegation**: `delegate` hands a task to a subagent and waits; `subagent` starts one
  that keeps working while you answer and reports back when it is done, waking the parent
  to act on it. `peer: true` creates a *normal* conversation instead — it appears in your
  rail marked as agent-created, outlives its creator, and can have subagents of its own.
  Ownership, depth, peer ceilings, reachability, and the wake budget are configurable in
  the overlay and visible in the inspector's Delegation card. See
  `docs/adr/0008-delegation.md`.
- Provider connect/disconnect from the UI, 42 providers, 60+ models each where the key allows.
- **Recovery**: if the harness process dies the gateway says so ("harness down" with the
  reason), restarts it with backoff, and resumes every run from its last commit — about
  two seconds. The stream sends a keepalive and the client reconnects on its own.
  See [ADR 0009](docs/adr/0009-liveness-and-recovery.md).
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
make check         # fast: the compiler and the unit tests, no processes (~6s)
make lint          # the static rules: gofmt, vet, staticcheck, tsc, eslint
make test          # everything, including the end-to-end feature tests under -race (~2min)
make ui            # drives the real client in headless chromium (needs a running gateway)
make build         # gateway build
make dev           # dev provider + gateway, workspace = current directory
```

`docs/engineering/standards.md` is what the code is held to, rule by rule, with the check that
enforces each and the bug behind the ones that matter. `make tools` installs the linters.

`docs/features.md` is the inventory: what the platform does, stated as things that are
observable, and the test that covers each one. Read it before changing behaviour, and add to it
when adding a feature.

The end-to-end tests (`gateway/internal/e2e`) run a real gateway and a real worker against a
scripted provider, so nothing calls a model and nothing needs a network. They need `bun` and
`make deps`; without them they skip with a reason. A feature driven by a tool call — a guard
blocking one, a subagent being spawned — is driven by `ACORNFALL_DEV_SCRIPT`, a JSON file of
rules matched against the last user message; see `docs/features.md`.

The Markdown renderer in `gateway/web/markdown.js` **escapes the source once, up front**,
and every later step operates on escaped text. Model output and tool output are
untrusted — a tool result can contain anything a file or a command produced — so raw
HTML must never survive, and link targets are scheme-checked rather than passed through.
`scripts/check-markdown.mjs` exists mostly to keep that true.

`make ui` exists because two bugs shipped that curl could not see: an element looked up
but never declared, and a modal whose visibility an author rule silently overrode. It
checks that the panels resize and remember their width, that inspector sections start
closed and persist, that maximize collapses the others, and that the settings sheet
starts hidden — then reloads and confirms the preferences came back.

The worker protocol is defined once per language — `worker/src/protocol.ts` and
`gateway/internal/protocol/protocol.go` — and documented in `docs/adr/0002-layers-and-protocol.md`.
