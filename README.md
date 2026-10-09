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
| `gateway/web/` | The embedded interface: the built bundle the gateway serves. |
| `ui/` | The interface itself: React, tokens, Storybook. Built by `make ui-build`. |
| `tools/` | Browser-driven checks. |

## Requirements

- Go 1.27+
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
`--token <secret>`, `--worker-dir <dir>`, `--workspaces-dir <dir>` (default
`~/acornfall/workspaces`), `--sandbox-engine <microsandbox|host>` (default: microsandbox;
`host` runs the tools on this machine with no isolation — see
[ADR 0015](docs/adr/0015-host-engine.md)), `--allow-vm-nesting <true|false>` (default: true;
a workspace's sandbox is asked to nest virtual machines when the engine and the machine can,
and boots without it otherwise — see [ADR 0018](docs/adr/0018-allow-vm-nesting.md)).

Each of those has an environment variable, for a service manager or a container that should
not carry flags: `ACORNFALL_HOME` or `ACORNFALL_DATA` for the install folder,
`ACORNFALL_TOKEN` for the token, and `ACORNFALL_WORKER` for the worker's directory. A flag
wins over the variable.

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
- **Workspaces**: a folder, its own `AGENTS.md`, config, agents, skills, and commands — under
  `.agents/` (the ecosystem's name, so a bundle written for another harness works) or
  `.acornfall/`, which wins when a folder has both. Each workspace runs its own
  worker and storage, started on first use. See `docs/adr/0011-workspaces.md`.
- **Sandboxed execution**: what the agent *runs* runs in a microVM — one per workspace, the
  workspace mounted read-write at its own path and the global resource folders (`~/.agents`,
  the install's agents/skills/prompts/commands) read-only at theirs, nothing else, no network —
  and so does every file the agent reads or writes. The worker stays outside it, next to the
  provider key. A skill's script therefore runs where its instructions say it lives, while the
  install's credentials, token, and state are not paths inside the guest. When the engine
  or the hypervisor is missing the tools refuse rather than run on the host; `acornfall doctor`
  says which it is. `--sandbox-engine host` is the explicit alternative for a machine without a
  hypervisor or a fast development loop: the tools run on the host, unconfined, and the state
  and doctor say so. A workspace is allowed to nest virtual machines — run a hypervisor inside
  its sandbox — when the engine offers it and the machine can grant it; when it cannot, the
  sandbox boots without it and doctor and the state say why. See `docs/adr/0012-sandbox.md`,
  `docs/adr/0014-global-resources-in-the-sandbox.md`, `docs/adr/0015-host-engine.md`, and
  `docs/adr/0018-allow-vm-nesting.md`.
- **Slash commands** from `<home>/commands/`, `~/.agents/commands/`, and the workspace's
  `.agents/` or `.acornfall/` — under `commands/` or, since it is the same thing by another
  name, `prompts/` — expanded server-side so the transcript records what the model saw.
- **Guards**: declarative rules that block a tool call and say why — a command pattern, or a
  path outside the workspace — accumulating across layers and visible in the inspector.
- **Workspaces are managed from the interface**: create by name inside the workspaces folder
  (`--workspaces-dir`, default `~/acornfall/workspaces`), and forget one (which never deletes
  the folder or the history). Pointing a workspace at a folder elsewhere is
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

`~/.acornfall/agents/<name>.md` (global) or `<workspace>/.agents/agents/<name>.md`
(workspace, shadows a global definition of the same name). The workspace bundle may also be
`<workspace>/.acornfall/`, and that one wins when both exist: `.agents` is the ecosystem's
name — a bundle written for another harness works here, and `~/.agents/skills/` is read too —
while `.acornfall` is where you keep what is yours alone:

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

Memory, MCP, codemode, multi-user, triggers, versioned agent definitions, and the parts of
the interface that are being rebuilt. `docs/adr/` holds the designs they will land against;
ADR 0012 lists what the sandbox deliberately does not cover yet.

## Development

```bash
make check         # fast: the compiler and the unit tests, no processes (~6s)
make lint          # the static rules: gofmt, vet, staticcheck, tsc, oxlint, oxfmt
make modernize     # the Go idiom analyzer; a daily workflow prompts with it, the gate does not
make test          # the default gate: units + the feature suite, no hypervisor (~30s)
make test-sandbox  # the microVM engine boundary: live driver + SDK + 4 e2e tests (~35s; needs /dev/kvm)
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
`make deps`; without them they skip with a reason. `make test` runs them with the sandbox tier
forced off, so the tools take the refusal path and the command behaves the same everywhere;
`make test-sandbox` runs them against real microVMs where there is a hypervisor — the tiers
are [ADR 0013](docs/adr/0013-test-tiers.md). A feature driven by a tool call — a guard
blocking one, a subagent being spawned — is driven by `ACORNFALL_DEV_SCRIPT`, a JSON file of
rules matched against the last user message; see `docs/features.md`.

The Markdown renderer in `ui/src/components/transcript/render-markdown.ts` **escapes the source
once, up front**, and every later step operates on escaped text. Model output and tool output
are untrusted — a tool result can contain anything a file or a command produced — so raw HTML
must never survive, link targets are scheme-checked rather than passed through, and images are
refused outright: a remote image in a reply is fetched by your browser, which is a way to
signal information outward. The checks for all of that live in
`ui/test/render-markdown.test.ts` under jsdom, because the sanitiser needs a DOM — and needs
one whose parser it can trust.

`make ui` exists because two bugs shipped that curl could not see: an element looked up
but never declared, and a modal whose visibility an author rule silently overrode. It
drives the served interface in a real browser: the splitter resizes the rail and the width
comes back after a reload, transcript items are neither squashed nor clipped, pane
controls are per pane, the theme toggle persists, and the phone gets a drawer instead of a
rail eating the transcript. The inspector and settings-sheet checks arrive with #13.

The worker protocol is defined once per language — `worker/src/protocol.ts` and
`gateway/internal/protocol/protocol.go` — and documented in `docs/adr/0002-layers-and-protocol.md`.
