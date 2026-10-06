# ADR 0014 — The global resources are mounted into the sandbox, read-only

Status: accepted, built
Date: 2026-10-06

## Context

The worker reads a skill, an agent definition, a prompt template, or the global config from
the host and hands the model its text. The skill tool ends its answer with
`Directory: /home/me/.agents/skills/review`, which is the path the instructions use — and that
path did not exist inside the sandbox: [ADR 0012](0012-sandbox.md) mounts the workspace and
nothing else. A skill whose body says "run `scripts/check.sh`" therefore delivered the text
and failed at the first command, and every global skill with a script was broken this way.

Mounting `<home>` in full is the obvious shape and the wrong one: it holds
`credentials.json`, `token`, and `state/`. The workspace's own resource files are already
inside its mount; this decision is about the *global* layers, `~/.agents` and the install's
own folders.

## Decision

Every sandbox mounts, **read-only, at the same path**:

| Path | Why |
|---|---|
| `~/.agents` (in full) | the ecosystem's bundle: `config.json`, `agents/`, `skills/`, `prompts/`, `commands/` |
| `<home>/agents`, `<home>/skills` | the install's definition and skill folders |
| `<home>/prompts`, `<home>/commands` | the template folder under both names, because both are read |
| `<home>/config.json` | the install's config file, when it exists |

**Read-only is the decision, not a detail.** The agent may read its instructions and run their
scripts; editing them from inside the sandbox would be self-modification — a way to persist a
change to every future conversation's instructions — and that belongs behind review
(issue #17).

**The list is explicit, and `<home>` is not on it.** `credentials.json`, `token`, and `state/`
are the reason: the install is never mounted, the named resource folders are. A test pins
that the install folder, its credentials file, and its state are never in the list.

**The folders are created at install; the file is conditional.** `serve` creates the five
folders before any worker can start, so the mounts always resolve, including on a fresh
install. `config.json` cannot be created on the user's behalf — an empty one would be a
decision about defaults nobody made — and the engine refuses a mount of a path that is not
there, so it is mounted when it exists at sandbox creation. Writing one later needs the
sandbox recreated; `msb modify` can do that without discarding the sandbox's disk.

**A script's interpreter is the workspace image's business.** `sh` and `bash` are in every
base image; a `python` or `node` script needs the image to provide the runtime. That is the
same rule as for a command the model writes itself, and it is not something this layer fixes.

## Alternatives

**Mount `<home>` in full.** Rejected: it puts `credentials.json`, `token`, and `state/` inside
the guest. The sandbox's value is that the provider credential exists only on the host side.

**Mount them read-write.** Rejected: the agent could rewrite its own instructions, and the
rewrite would apply to every workspace and every conversation after it. Self-improvement is
issue #17 precisely because it is a review question, not a mount flag.

**Copy the resources into the sandbox at creation.** Rejected: every copy would be stale the
moment a file changed, and R5 ("reload re-reads files") would stop being true inside the
guest. A bind mount shows edits live.

**Mount only what a known skill needs.** Rejected: instructions name paths and scripts open
what they open; the platform cannot enumerate that. The folder is the unit.

## Consequences

- A global skill with a script works: the directory in the tool result resolves inside the
  sandbox, and the command the instructions name runs.
- The guest's `/home` is no longer empty — [ADR 0012](0012-sandbox.md) said it was — because
  it now holds exactly the user's `.agents` bundle. Nothing else of ours is there.
- Resource *reads* still come from the host in the worker, which is where the text that
  reaches the prompt comes from; the model's own file tools and every command see the same
  paths through the mount.
- Global instructions stay per install. A workspace that needs different ones uses its own
  `.agents/` or `.acornfall/` bundle, which was already true.
