# ADR 0007 — Model resolution and the install default

Status: accepted, implemented
Date: 2026-10-04

## Problem

Every conversation without a model was given one by copying a guess into its binding.
That pinned the guess: "the first model of the first authenticated provider"
(alphabetically `minimax-m3`) became permanent for every conversation created before
anyone changed their mind. There was no way to say "new conversations should use this
model", and no way to say "this conversation follows whatever the default is".

## Explicit versus inherited

The fix is to separate a **choice** from a **resolution**.

- A conversation's binding records only what was chosen *in that conversation*.
- A conversation with no model in its binding is **inheriting**, and what it runs is
  resolved at each apply.

Control is the single place that resolves, and the order is:

1. **The conversation's explicit model**, when the user picked one here.
2. **The agent definition's model**, when the definition names one.
3. **The install default.**
4. Nothing → `ErrNoProvider`, with a message telling the user to connect a provider.

A definition naming a model beats the install default on purpose: a definition that pins
a model means it, and a global default should not silently override a deliberate choice
made one layer down.

The worker is always told a concrete model. Control resolves, the worker applies. The
worker's own rule ("an explicit provider/modelId beats the definition") therefore agrees
with control's rather than competing with it, because control only passes what won.

## The default

`settings.json` gains `defaultModel`, set with `POST /api/default-model` or the **Make
default** button beside the model picker. Changing it re-applies to every *inheriting*
conversation immediately, so the change is visible without a restart, and it does not
touch conversations that chose their own model.

When no default is set, or the stored one is no longer available (a provider was
disconnected, a model disappeared from the catalog), control derives one — the `--model`
flag, else the first model of the first authenticated provider — and **persists it**. The
guess is fine once; leaving it implicit is what made it hard to find and impossible to
change.

`State.Agent` is the **effective** binding, so the pickers show what will actually run.
`State.ModelInherited` says whether this conversation chose it. A picker that showed an
empty selection for an inheriting conversation would be technically truthful and
practically useless.

## Partial updates

`AgentChange` uses pointers, so "leave the model alone" and "clear the model and inherit
again" are different requests:

```json
{}                                  → change nothing
{ "thinkingLevel": "low" }          → keep the model, set thinking
{ "provider": "", "modelId": "" }   → drop the choice, inherit again
{ "definition": "" }                → the layered defaults, not "no definition field"
```

The previous shape used zero values for both meanings, which is how a partial update
silently blanked a model.

## The ordering bug this shipped with

`ensureDefault` ran *before* the settings file was read. On every boot it found no
default, derived one, and **overwrote the persisted default** — so a default set in the
UI survived exactly until the next restart, which is worse than not persisting at all,
because it looks like it worked.

Settings are now read first, and the function that does it is named `loadSettings`, not
`loadPersistedActive`, so the next reader can see the ordering requirement from the call
site.

## Still missing

- The default is per install, not per workspace. With more than one workspace they would
  want their own, and the setting belongs beside the workspace rather than the data dir.
- Per-agent defaults beyond what a definition can express (for example a default thinking
  level for the install).
- No model allowlist: an agent definition can name any model the credentials reach.
