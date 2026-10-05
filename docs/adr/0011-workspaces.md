# ADR 0011 — Workspaces

Status: accepted, in progress
Date: 2026-10-04

## What a workspace is

A **folder, a resource bundle, and a trust decision**. A conversation belongs to exactly
one, for life. It is not a sandbox: isolation is the `ExecutionEnv` seam, as it is in dsh.

## One worker per workspace

This reverses ADR-0001's "Workspace = one Worker = one Harness = one Storage", which was
written when a workspace was a singleton. The reasoning for reversing it: isolation of a
crash, of a storage, and of an event loop; deleting a workspace deletes its history with
it; and one workspace's heavy run cannot make another workspace's interface sluggish.

What it costs, accepted deliberately:

| | |
|---|---|
| switching workspace | a process start, unless the worker is warm |
| delegation | **within a workspace only.** A worker does not know other workspaces exist, which is a boundary rather than a limitation |
| memory | one Node process per *warm* workspace |
| conversation ids | only unique inside a workspace's storage |

### Conversations get a composite identity

This is the consequence that reaches every surface: `general/1276`, not `1276`. Two
storages both mint `1`.

- URL: `/c/general/1276`
- API: `/api/workspaces/general/conversations/1276/messages`
- Internally: one key `workspace/id` for bindings, resolved agents, attachments, and views.

Control's worker-facing state moves into the worker's slot: conversations, catalog,
providers, policies, view cache. What stays in control is what spans workspaces:
credentials, defaults, model bindings, subscribers, and the registry itself.

## Layout

`--home` is the installation folder, configurable, default `~/.acornfall`. A workspace's
folder defaults to `<home>/workspaces/<name>` and may point anywhere, so an existing repo
can be a workspace without being moved.

```
<home>/
  config.json                 global defaults
  credentials.json            provider credentials, shared by every worker
  settings.json               defaults, bindings, the workspace registry
  agents/ skills/ commands/   global resources
  state/<workspace>/          runtime state: session.sqlite and friends
  workspaces/
    general/                  a workspace: the agent can read and write here
      AGENTS.md
      .acornfall/             its resources: config.json, agents/, skills/, commands/
      projects/               cloned or created projects
```

**Runtime state lives outside the workspace folder.** The agent has `bash`; its own
database should not be a file it can delete.

**Workspace resources are looked up in both places**, preferring the visible one:
`<ws>/skills` then `<ws>/.acornfall/skills`. A workspace that is a repo you cloned should
not be littered with our directories, and `AGENTS.md` at the root stays conventional.

## The resource layer

An existing resolver gains a middle layer: **global → workspace → agent**. Not a new
mechanism — the overlay already folds layers and explains them, and with one worker per
workspace each worker simply receives a different workspace path.

| Resource | Rule |
|---|---|
| `instructions` (config) | concatenate global → workspace → agent |
| `AGENTS.md` | its **own section** `workspace-rules`, so the inspector can show and diff it |
| `model`, `thinking` | last defined wins |
| `skills`, `commands` | union; the workspace shadows global on a name clash |
| `allow-tools` / `deny-tools` | replace / union, deny wins |
| `delegation` | merge, most specific wins |

A name clash between two workspaces needs no rule: a conversation sees one workspace, so
resolution has one answer for it.

## Trust is configuration, not a prompt

A workspace's files are instructions from a folder, and folders are things you clone. An
`AGENTS.md` in an untrusted repo is prompt injection; a skill that says "run this script"
is worse. Trust is therefore a field on the workspace record with a global default in
`config.json` — no interactive prompt, which the UI cannot do anyway.

**Untrusted means the folder and nothing else**: the workspace's `AGENTS.md`, config,
agents, skills, and commands are not loaded. Global resources still apply.

## Hooks: declarative first

durable's hooks are code registered in the process, so a workspace hook file would execute
workspace-provided code inside the worker. Declarative hooks (`denyTools`, tool-call
guards) ship first, expressed in the workspace's `config.json`. Code hooks come later,
behind the same trust field.

## Commands

Slash commands are prompt templates discovered from the same two layers, listed over the
API, and **expanded server-side** so there is one implementation and the expanded text is
what lands in the transcript.

## What a workspace does not do yet

- **Projects are not managed.** The folder can hold `projects/`, and the agent can create
  or clone there, but there is no project UI. That is a later feature on top of this.
- **No confinement.** File tools take a path and the workspace is their working directory,
  but nothing stops `bash` reading elsewhere. Confinement is the sandbox tier, and until it
  lands this must not be described as a boundary it is not.
- **No moving a conversation between workspaces.** Its `cwd` and rules would change
  mid-transcript, and earlier tool calls would reference paths that no longer resolve.
  Forking into another workspace is the honest version of that, and it can come later.
- **No cross-workspace view.** The rail shows one workspace, because listing all of them
  would mean starting every worker, which is what laziness exists to avoid.

## Migration

Today's `--workspace` becomes the **general** workspace's folder, and today's storage
moves to the general workspace's state directory, so every existing conversation appears
where it was. A conversation with no workspace recorded reads as general.
