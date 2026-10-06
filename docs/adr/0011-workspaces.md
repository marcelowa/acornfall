# ADR 0011 — Workspaces

Status: accepted, in progress
Date: 2026-10-04

## What a workspace is

A **folder and a resource bundle**. A conversation belongs to exactly one, for life. It is not
a sandbox: isolation is the `ExecutionEnv` seam and one microVM per workspace, decided but not
yet built — see "Trust, and why it went" below for what replaced the trust flag.

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

`--home` is the installation folder, configurable, default `~/.acornfall`. It holds
configuration, credentials, and runtime state, and it is hidden.

**Workspaces are created in a separate, visible folder**: `--workspaces-dir`, default
`~/acornfall/workspaces`. Two folders rather than one because they are two different things:
installation state is ours and hidden, while a workspace is the reader's own content and
belongs somewhere they would look. The folder is recorded in `workspaces.json` rather than
in the global config, because that config is what shapes prompts and a control-plane path
there would be a concern in the wrong file. The flag wins for a run and is recorded, so the
decision sticks instead of having to be repeated.

A workspace's folder may be anywhere — an existing repository can become one without being
moved — but only an operator can point it there. See below.

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
      .agents/                its resources, the ecosystem's name: config.json, agents/,
                              skills/, commands/ — shared, and committed with the project
      .acornfall/             the same bundle under our name, which wins when both exist
      projects/               cloned or created projects
```

**Runtime state lives outside the workspace folder.** The agent has `bash`; its own
database should not be a file it can delete.

**Workspace resources live in `<ws>/.agents/` or `<ws>/.acornfall/`**, with one exception:
`AGENTS.md` sits at the workspace root, where the convention puts it. Both names read the same
bundle; ours wins when a folder has both (ADR 0004). The split is useful in practice: the
`.agents` copy is the one a project shares, and the `.acornfall` copy is the one you keep to
yourself — which is why this repository commits the first and ignores the second.

The first version looked for `skills/`, `agents/`, and `commands/` at the root as well, so
they would be visible and editable. That was withdrawn: a workspace is often a repository
somebody else wrote, and a repository with its own `agents/` directory would silently be read
as ours. The folder has to be *named* to be read, and now there are two names that are
unmistakable: the ecosystem's convention, and ours.

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

## Trust, and why it went

**Removed.** This section is kept because the reasoning is worth remembering, and because the
thing it was protecting against was real — it was just in the wrong place.

A workspace carried a `trusted` flag: when off, the workspace's `AGENTS.md`, config, agents,
skills, and commands were not loaded (global resources still applied). The reasoning was that a
workspace is often a repository somebody else wrote, and an `AGENTS.md` in a cloned repo is
prompt injection — a skill that says "run this script" is worse. The flag was configuration
rather than a prompt, because the interface cannot ask a question anyway.

What it actually did was make the *one folder the agent is supposed to work in* the one folder
it could not take instructions from, while leaving its tools free to read the whole machine. The
instruction channel was closed and the reach was not. Two consequences followed: the flag made
work worse (a repo's own rules are usually why you pointed an agent at it), and it gave a
false sense of safety, because "untrusted" read as "contained" and nothing was contained.

The lever for that is capability, not reading. Reach is the sandbox's business: one microVM per
workspace, with the workspace mounted read-write and the global resource folders read-only at
their own paths ([ADR 0014](0014-global-resources-in-the-sandbox.md)), egress limited to the
model endpoint, and a policy layer for what a conversation may do. A workspace's own files are
read, and the question "should this folder's text steer the model" becomes a policy decision —
later, and in one place, rather than a boolean on the record that silently changed which files
existed.

Every workspace's resources are read now, and the API **refuses** a `trusted` field rather than
ignoring it: a caller asking for the old behaviour should be told, not humoured.
`TestAWorkspacesOwnResourcesAreRead` pins the reading; `TestTheTrustFlagIsGone` pins the refusal.

## Hooks: guards, declaratively

durable's hooks are code registered in the process, so a workspace hook file would execute
workspace-provided code inside the worker. That is a security decision, not a configuration
field, so it comes later and behind the sandbox. What ships first is the half that is
configuration: **guards on tool calls**, which can only deny and must say why.

```json
{ "defaults": { "hooks": { "guards": [
  { "tool": "bash", "arg": "command", "pattern": "git\\s+push|rm\\s+-rf",
    "reason": "pushing and recursive deletes are not allowed in this workspace" },
  { "tool": "write", "arg": "path", "outside": true,
    "reason": "writes stay inside the workspace" }
] } } }
```

Two matchers, because they are the two that matter for an assistant with a shell: do not run
this command, and do not write outside the workspace. The argument is named explicitly
rather than guessed, so nothing matches by surprise, and a guard without a reason is
rejected at load because the model is the one who is told it.

Guards accumulate across layers — a rule added globally holds in a workspace — and resolve
**per conversation** through the same overlay as the agent, so a definition can be built on
top of them and a conversation working outside the workspace root is still confined to it.

Verified against a real workspace: `git push origin main` and a write to `/tmp` were both
blocked with their reasons, which the model read and reported, while a write inside the
workspace succeeded. Guards are visible in the inspector's Agent card and, in full, in the
layer trace that shows each layer's raw contribution.

**Code hooks remain open**, and the reason is unchanged: executing a workspace's code inside
the worker is not a config field.

## Commands

Slash commands are prompt templates discovered from the same two layers, listed over the
API, and **expanded server-side** so there is one implementation and the expanded text is
what lands in the transcript. A message that merely starts with a slash is never
rewritten: an unknown name comes back unchanged.

```markdown
---
name: summarize
description: Summarize a file in three bullets
argument-hint: <path>
---
Read the file $ARGUMENTS and summarize it in exactly three bullets.
```

A template without `$ARGUMENTS` gets the arguments appended, because losing what the user
typed is worse than an extra line.

## Two bugs this stage produced, both worth recording

**A worker's lifetime is not a request's.** Lazy starting passed the HTTP request's context
to `exec.CommandContext`, so a workspace's worker was killed the instant the request that
started it finished — which presents as a worker crashing on startup, on the second
request rather than the first. The process is no longer tied to any context; the pool
ends it.

**The migration ran before the sidecars existed to move.** Moving `session.sqlite` without
its write-ahead log is how the most recent commits are lost, and it left four megabytes
behind.

## Managing workspaces, and who may point at what

The interface can list workspaces, create one **by name**, and forget it.
Removing unregisters it and stops its worker; it never deletes the folder or the history,
the same way deleting a conversation is a tombstone.

**The interface cannot name a path.** Creating a workspace takes a name, and the folder is
`<workspaces-dir>/<name>` — created if absent, adopted if a folder of that name is already
there. A `path` in the request is **refused rather than ignored**, because accepting and
dropping it would be a field that does nothing; the error says which command to use
instead. Pointing a workspace at a folder anywhere else is `acornfall workspace add <name>
<folder>`, an operator's command, and the registry is one file with one owner so the
command line and the server cannot disagree about its shape.

That is the whole point of the folder: the interface is scoped to one directory it may
create in, and everything else on the machine stays out of reach *of the interface* — which
is a weaker and more honest claim than confinement, since nothing yet stops an agent's
`bash` from reading elsewhere. That remains the sandbox tier's job.

`running` is runtime state and is never persisted: a stored `true` would be a claim about a
process that does not exist after a restart.

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
