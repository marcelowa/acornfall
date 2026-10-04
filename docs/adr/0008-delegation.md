# ADR 0008 — Delegation and conversation addressing

Status: accepted, partially implemented
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

## What is not built yet

- **Background children.** `delegate` blocks. A child owned by a background anchor
  task would survive your Esc and not keep the parent busy, and its answer would be
  delivered later as a follow-up with a `requestId` so a restart cannot deliver it
  twice. That delivery path is the sharp edge and it is deliberately not rushed.
- **Peer creation** (`peers: true`) is parsed, resolved, and reported, but no tool
  creates a peer yet. When it does, an agent will be able to write to your rail,
  which is why the provenance marker and `maxPeers` matter.
- **Messages between conversations appear as `pi.user` entries.** They need a
  provenance header so a child's transcript does not read as if you said it.
- **A message never triggers an automatic reply.** Reports must be explicit, or two
  agents will talk until the credit card intervenes. That rule belongs with the
  background path.
- **No isolation**: every conversation shares one working directory, so two agents
  editing one file will not notice each other. Accepted for now.
