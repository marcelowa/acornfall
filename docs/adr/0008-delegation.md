# ADR 0008 — Delegation and conversation addressing

Status: accepted, foreground and background implemented
Date: 2026-10-04

## Problem

Two requests that turn out to be one design: conversations should keep working when
you look away, and a conversation should be able to hand work to another
conversation — with the freedom to talk to *any* conversation, not only its own
children.

## Background runs already work

A run is a durable task in the harness, not a property of an attachment. Detaching a
conversation disposes a view subscription and nothing else, so switching away never
stopped a run. Verified before designing anything: a run started in 257 finished
while 228 was attached.

What was missing was **visibility**, which is what this change adds:

- `running`, `lastEntryId`, `tokens`, and `cost` per conversation, all read from
  committed state, so a run that survived a restart still reports as running.
- The rail marks a live run with a pulsing dot, and content newer than your last
  look with a second dot. The unread cursor is the newest entry id, held in the
  browser: it is a reading position, not a fact about the conversation.
- Control polls the list every three seconds **only while a client is attached**,
  and publishes only when a signature changes, so a quiet workspace stays quiet.
  Nothing pushes news about a run in a conversation you are not watching.

Per-conversation spend is not decoration. An unattended run spends money with nobody
looking, and that was invisible until now.

## Ownership is lifetime, addressing is permission

The mistake to avoid is treating "subagent" as a kind of conversation. It is not: it
is a conversation with an **owner**.

| | ownerless (peer) | task-owned (child) |
|---|---|---|
| In the rail | yes | no |
| Created by | you, or a conversation | a conversation |
| Abort cascade | none | creator's abort reaches it |
| Creator waits for it | no | yes, if it wants |
| Counts toward depth | no | yes |

That table produces the requested rule without a special case: a child cannot create
children because it sits at `depth == maxDepth`, while creating **peers** is a
separate permission that is not depth-limited. "A child cannot spawn children, but it
can make siblings" is therefore a consequence of the ownership model rather than a
rule bolted onto it.

Permission lives in the overlay, alongside `allow-tools`, so install defaults,
workspace defaults, and a definition all apply:

```json
{ "defaults": { "delegation": { "spawn": true, "peers": true,
                               "maxChildren": 4, "maxDepth": 1, "maxPeers": 2 } } }
```

```markdown
---
delegation: spawn, peers
max-children: 3
max-depth: 2
---
```

And it is visible rather than documented: the inspector's **Delegation** section
reports the policy, the depth against its limit, and the children against theirs. Its
`Subagents` section lists what the active conversation created, with live status,
spend, and a way to open one.

## Children are listed, not hidden

The list used to drop every conversation with an owner, which kept subagent
transcripts out of the rail. But a filter in the worker also means the UI can never
show them, so ownership is now **reported** and the filtering moved to where the
decision belongs:

- the rail lists conversations with no parent;
- the inspector groups the ones that have one.

TypeScript pointed out the contradiction while this was being written: a `continue`
that skipped owned conversations made a later read of `owner` unreachable, which is
exactly the shape of the mistake.

## Verified

A real delegation, end to end:

```
162 → delegate → child 322 (parent=162, 3,354 tokens of its own)
parent's tool result carried the child's answer, and its reply used it
322 policy: depth 1, children 0, canSpawn false — "depth 1 of max-depth 1"
162 policy: depth 0, children 1 of max 4, canSpawn true
```

The subagent tool is `replay: "safe"`: the ownership index is committed in the same
commit that creates the child, so a rerun after a crash finds the child it already
made instead of making a second one.

## Background subagents

`delegate` blocks. `subagent` is a relationship instead: the child keeps working while
the parent answers, and its answer arrives later as a new message — which, per the
product decision, the parent **acts on without waiting for anyone**. A background
subagent that could only work while someone watched would not be background.

Three durable pieces, following the shape pi-durable documents in
`test/examples/23-subagent-background.ts`:

- **An anchor task per subagent.** A background task that finishes at once and exists
  only to own the child conversation. Ownership is what an abort reaches, and
  "background" is the boundary where a parent's Esc stops.
- **A reporter task per message.** Two checkpointed phases: deliver the message, wait
  for the answer, then report it to the parent as a `followUp` input. Two request ids
  — one for the message, one for the report — so a restart mid-flight cannot deliver
  either twice. This is the piece that has to survive a crash, which is why it is a
  durable intention with an idempotency key rather than a promise.
- **A delegation document** per conversation: subagents by the name the model gave
  them, the live reporters, and how many wake-ups have been spent.

Verified with a real model, including the part that matters: the parent answered
`ACKNOWLEDGED`, **stopped spending**, and was woken later when the child finished.

## The wake budget

Auto-continuation is the feature, and it is also the risk: without a limit, a chain of
agents can talk to each other indefinitely on your card. `max-wakes` caps how many
times a subagent's answer may wake its parent (default 12).

Verified by setting it to zero. The parent was told:

```
[subagent budgettest finished, but this conversation has used its 0 wake-ups.
 Read conversation 454 for the answer.]
```

and it then used `list` and `read` to fetch the answer itself. That is the property
worth having: **the budget does not lose information, it moves the work from an
automatic wake-up to an explicit read.** The answer is always in the child's
transcript; the budget only decides whether anyone is notified about it.

The count is read then written, so two reporters finishing at once could in principle
spend one wake-up more than the budget allows. That is accepted: the budget is a guard
against a runaway chain, not an invariant, and delivery itself is idempotent.

## A subagent is told what it is

A child inherits its parent's model, tools, and working directory, but **not its
instructions**. Inheriting them would have the subagent introducing itself as the
parent's assistant and treating the parent's rules as its own. It gets a role line
instead, plus a named definition's instructions when one is given:

> You are the subagent "lister". Another conversation started you; answer its requests
> directly, and say what you did.

## What is not built yet

- **Peer creation.** `peers: true` is parsed, resolved, and reported, but no tool
  creates a peer yet. When it does, an agent will be able to write to your rail, which
  is why the provenance marker and `maxPeers` matter.
- **Messages between conversations appear as `pi.user` entries.** The report text is
  prefixed (`[subagent lister finished] …`), which is what the model needs, and a human
  reads it correctly enough — but it is a text convention, not a structured field. A
  custom entry alongside it would let the UI render a chip instead of relying on the
  prefix.
- **A tool phase that throws is now logged** (`onReport`) rather than silently
  vanishing. Before that, a reporter that failed left no trace at all: the run simply
  never continued.
- **No spend cap.** Wake-ups are bounded; tokens are not. A conversation can still
  spend without limit across its subagents, and per-conversation spend is only visible
  in the rail.
- **No isolation**: every conversation shares one working directory, so two agents
  editing one file will not notice each other. Accepted for now.
