# ADR 0007 — Resolution and the install defaults

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

## Three defaults, one mechanism

`model`, `thinking`, and `agent` all resolve the same way: **what this conversation
chose → what its definition says → the install default**. Three fields, one order, no
special cases. Each is settable on its own:

```
POST /api/default-model     { provider, modelId }
POST /api/default-thinking  { level }        // empty clears
POST /api/default-agent     { definition }   // empty means the layered defaults
```

The inspector's **Defaults** card shows all three, marks the ones the active
conversation follows with an asterisk, and offers "Use current" to adopt what is running
here. Clearing is offered where it means something: a model default cannot be cleared
because there would be nothing to fall back to.

Each picker sends only its own field. `AgentChange` uses pointers precisely so that
choosing a model does not also pin the agent and the thinking level that the conversation
was inheriting — a bug this shipped with, because the picker was echoing back everything
it saw in `State.Agent`.

## Thinking level resolution

A level is only meaningful relative to a model, and models declare scales that are
neither complete nor uniform. Measured on the installed catalog:

| model | levels |
|---|---|
| `minimax-m3` | `off, minimal, low, medium, high` |
| `hy4-preview` | `off, high` — a gap |
| `deepseek-v4-flash` | `off, low, high, max` — another shape |
| `kimi-k3` | `max` — nothing else |

`resolveThinking` takes the preference **chain** — what this conversation chose, then what
its definition says, then the install default — and applies:

1. **The first preference the model supports.**
2. Otherwise **the closest supported level below the most specific preference.**
3. Otherwise **the lowest level the model offers.**

The whole chain is passed, not a pre-merged value. That distinction is the difference
between clamping and falling back: asked for `max` on a model that tops out at `high`,
a chain with an install default of `off` answers **`off`**, because the default gets a
chance before approximation does. The first implementation merged first and clamped
second, which answered `high` and quietly ignored the default.

Step 3 is not hypothetical. `kimi-k3` offers only `max`, so a request for `off` has
nothing below it; the honest answer is the level the model has, not a setting that
silently does nothing.

### Where specificity loses, and why

Step 1 can let a *supported* lower-specificity value win over an *unsupported*
higher-specificity one — a definition saying `medium` on a model offering only `off, high`
yields the install default rather than a clamped approximation of `medium`. This is the
one place the "a choice made one layer down beats a global one" rule does not hold.

It is that way deliberately: a preference the model cannot express is not a weaker
version of the intent, it is an unavailable one, and a supported value from a broader
layer is a defensible answer where an approximation of the original is a guess. The
alternative — always clamp the most specific preference — is a one-line change if it
turns out to match intent better in practice.

### Why the choice is still recorded

The applied level is resolved, but the **chosen** level stays in the binding. Switching
to a model that cannot express `medium` records `thinkingRequested: "medium"` and applies
a substitute; switching back restores `medium` exactly. The inspector shows
`off (asked for medium)` rather than appearing to have ignored the choice, and
`inherited.thinking` stays `false`, because the conversation did choose.

## The default

`settings.json` stores `defaultModel`, `defaultThinking`, and `defaultAgent`; changes
re-apply to every inheriting conversation immediately. Changing it re-applies to every *inheriting*
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

- The defaults are per install, not per workspace. With more than one workspace they
  would want their own, and the settings belong beside the workspace rather than the data
  dir.
- No allowlist: an agent definition can name any model the credentials reach.
- A default agent that disappears (renamed or deleted file) is dropped with a log line on
  reload, but nothing tells the user in the UI that it happened.
