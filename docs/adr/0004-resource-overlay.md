# ADR 0004 — Agent definitions and the resource overlay

Status: accepted, implemented
Date: 2026-10-04

## Problem

"Define skills, tools, rules and instructions per global, workspace, or agent" is
the requirement that turns this from a chat app into a platform. It needs a file
format, a resolution order, and — because a surprising prompt is otherwise
unfalsifiable — an explanation of which layer produced what.

## Layers

```
global     <data-dir>/config.json                <data-dir>/agents/<name>.md
           ~/.agents/config.json                 ~/.agents/agents/<name>.md
workspace  <ws>/.agents/config.json              <ws>/.agents/agents/<name>.md
           <ws>/.acornfall/config.json           <ws>/.acornfall/agents/<name>.md
agent      the definition file itself
```

A workspace definition **shadows** a global one with the same name. `config.json`
carries defaults that apply to every agent in scope; a definition applies to the
one agent it names. Both use the same contribution shape, so there is one mental
model rather than two.

### Two folder names, one bundle

`.agents` is the rest of the ecosystem's name for this bundle: it is where the Agent
Skills convention puts `skills/`, and what the other harnesses look for. A bundle written
for one of them therefore works here unchanged, and a skill you already have is not
something you rewrite to use this platform. `.acornfall` is our name, and a folder that has
both reads ours last, so ours wins: the interchange copy is the one you share, and the local
one is the one that overrides it.

`~/.agents` is read for the same reason, at the user level, because that is where the
convention puts a person's own skills.

Within a layer the order is therefore `~/.agents` → `<data-dir>` → `<ws>/.agents` →
`<ws>/.acornfall`, and each folder may hold `config.json`, `agents/`, `skills/`, and
`commands/`. Instructions concatenate in that order; a later model, thinking level, agent
definition, command, or skill of the same name replaces an earlier one.

## Contribution shape

```jsonc
// config.json
{ "defaults": { "model": "…", "thinking": "medium", "instructions": "…",
                "skills": ["a"], "allowTools": ["read"], "denyTools": ["write"] } }
```

```markdown
<!-- agents/researcher.md -->
---
name: researcher
description: Reads before it writes
model: opencode-go/minimax-m3
thinking: medium
skills: acorn-notes, web-research
allow-tools: read, bash, skill
deny-tools: write, edit
---
Free-form instructions, rendered as the `instructions` section.
```

Frontmatter and the body are both optional; a definition with neither is legal but
useless. Unknown frontmatter keys are logged by the worker, with the file they came
from, rather than silently ignored.

## Resolution

Layers fold in order: global, workspace, agent.

| Field | Rule | Why |
|---|---|---|
| `instructions` | Concatenate, in layer order | Every layer gets to speak; the most specific speaks last |
| `model`, `thinking` | Last defined wins | A specific layer overrides a general one |
| `skills` | Union; unset everywhere means all discovered skills | A global skill and an agent skill should both be available |
| `allowTools` | Replaces | An allow list is a statement about the whole set, so merging would be incoherent |
| `denyTools` | Union | Denial is additive; a workspace cannot be over-permissioned by an agent file |

**A deny always beats an allow**, and the resolved allow list is filtered through
the deny set, so no combination of layers can re-grant a tool.

Invalid configuration is an error, not a silent no-op: an unknown thinking level
or a tool name that is not registered fails the selection with a message naming
the offender. A config file that quietly does nothing is indistinguishable from a
config file that is not loaded, and that costs hours.

## Explainability

`GET /api/agents` returns every definition with its resolved form, plus the layer
trace: for each layer, its path and its raw contribution. The inspector renders
that trace directly, so "why is my prompt this" is answered by looking rather than
by bisecting files. Every resolved field can name its origin.

## The model-override rule

Selecting a definition with no explicit model adopts the definition's model, and
otherwise keeps the model already in use. A model chosen in the picker afterwards
beats the definition until the next definition change. This keeps two things true
at once: a definition can pin a model, and the picker still works the way a picker
is expected to.

## What the overlay cannot do yet

- It does not add sections other than `instructions`; a definition cannot
  contribute its own named prompt section.
- Skills are filtered by name but not configured per agent (no per-agent skill
  arguments).
- Tools are filtered by name only — no per-agent tool arguments, and no
  per-agent MCP servers.
- Definitions are not versioned. Nothing records which definition revision a
  request used, so a transcript cannot yet answer "which agent version said this".
  That is required before self-improvement means anything, and it is the reason
  the layer trace is stored in the resolved form rather than recomputed later.

## Consequences

- Prompt changes are visible as `pi.system` patches in the transcript, so the
  context inspector shows what changed between requests and when.
- Editing a definition takes effect on the next request after **Reload files**,
  with no worker restart and no lost conversation.
- The overlay is the compilation target for anything that later generates
  definitions — an agent proposing an edit to its own instructions lands here.
