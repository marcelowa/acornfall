# ADR 0017 — A conversation pins its settings when it is created

Status: accepted, in progress
Date: 2026-10-07

## Context

[ADR 0007](0007-model-defaults.md) separated a choice from a resolution: a conversation's
binding records only what was chosen *in that conversation*, and one that never chose keeps
inheriting — resolved at every apply through conversation → definition → workspace → install →
last resort.

That is right about a conversation and wrong about what someone expects from one. Changing a
workspace's default model moved every conversation that had never chosen, including
conversations with weeks of history: the same transcript would run on a different model
tomorrow, and the only trace was an origin label in a picker. "Which model did this
conversation use" had no answer that stayed true.

## Decision

**A conversation pins what resolves when it is created.** `Create` writes the effective model,
the thinking level that model can actually express, and the default agent's name — when one is
set and known — into the conversation's binding. From then on the conversation has its own
settings; a default changed later shapes the conversations created after it, not the ones
already here.

Three edges, each with a reason:

- **Conversations that predate this are pinned once**, on the next listing: the ones that never
  chose are written from what resolves at that moment. A conversation that already has a
  binding is left alone, because that is a choice; a subagent is left alone, because whatever
  created it configured it.
- **Nothing resolved means nothing pinned.** A workspace with no provider keeps inheriting until
  there is something to inherit, rather than pinning an empty model.
- **A definition that no longer exists is not pinned by name.** It would fail every open. The
  conversation keeps the fallback agent and the interface shows the stale default, so someone
  changes it instead of guessing.

The fallback agent has a name: **`general`**, which is what the worker resolves when no
definition is set. A `general.md` definition can take the name later without changing a single
binding.

## Alternatives

- **Keep inheriting and show the origin better.** The picker already said "workspace default".
  The problem was never that the origin was unclear; it was that a default could move a
  conversation at all.
- **Pin at the first message instead of at creation.** A conversation created a minute ago
  would still follow a default changed in between — exactly the surprise this removes.
- **Copy the values into the conversation's storage entries.** The binding is the place that
  already means "what this conversation chose", and it survives reloads and restarts on its own.

## Consequences

- `inherited` is false for every conversation created under this rule: the interface shows a
  conversation's own values instead of the layer that provided them. The origin labels stay
  useful for the defaults themselves, in settings, and for conversations that predate the rule.
- A pinned model that stops existing becomes a visible state rather than a silent resolution:
  the interface shows it as invalid and it stays that way until someone changes it.
- The default agent stops being an unnamed fallback in the interface: `general` is what a
  conversation with no definition runs, and it is a name that a definition can later fill.
