# ADR 0008 — Delegation and conversation addressing

Status: accepted, implemented, including peers
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

## Peers: a conversation an agent creates without owning

A subagent is owned and invisible. A **peer** is ownerless: it appears in your rail, it
outlives the conversation that made it, and it can create peers and subagents of its own.
It is how a conversation bootstraps something for you rather than for itself.

`spawn` takes `peer: true`. The three differences that matter:

| | subagent | peer |
|---|---|---|
| ownership | an anchor task owns it | ownerless |
| in your rail | no | yes, marked as created by another conversation |
| delegation tools | denied | keeps them, so it can have its own |
| reports back | yes | no, unless you ask (`report: true`) |
| counts toward depth | yes | no, which is why it may spawn |

That last row is the requested rule again: a child cannot spawn children because it
sits at `maxDepth`, while a peer is at depth 0 and may.

An ownerless conversation does not inherit the creator's agent the way a task-owned one
does, so a peer explicitly copies the model, thinking level, and instructions from the
creator's stored configuration. Tools are not copied — the stored form is names and
`configure` takes registrations — so a peer gets the full registered tool set. That is a
real difference from its creator and it is written down rather than discovered.

### Peers can make peers, so the workspace needs a ceiling

Watch what a single delegation produced:

```
162 → spawn peer "notes" → 894
894 → spawn peer "intro" → 911        ← a peer, creating a peer
```

`maxPeers` limits one conversation to two peers, but each peer may make two more, so the
graph multiplies at every level. `max-peers-total` (default 8) caps agent-created
conversations per workspace, enforced by counting them, and verified by lowering it to
the current count:

```
workspacetest was not started: agents have made 3 conversations in this workspace
of max-peers-total 2.
```

### Addressing is a permission, not a lookup

A conversation can address what it created, its own children, and its parent: the
conversations it has a reason to know about. Anything else needs `address: any`, which is
a deliberate choice for a hub conversation and the wrong default for a leaf. Refusals say
why, so the model can adapt instead of retrying.

## Attribution: those `pi.user` entries are not yours

A message between conversations has to be admitted as an input, because an input is what
starts a run — there is no other way to wake a conversation. So a delegated task, and a
subagent's report, both land as `pi.user` entries. The model reads them fine (they carry
a `[from conversation 162]` or `[from subagent prov2]` prefix), but a transcript the
*user* reads attributed another agent's words to them. In a peer that is worse, because a
peer's transcript is one people actually read.

Fixed by recording provenance rather than inferring it:

- A submission's settled record carries the **entry id** it placed (`settled.entry`), so
  the sender is recorded against the exact entry instead of being guessed from its text.
- A per-conversation `acornfall.messages` document maps entry id → sender
  (`{conversationId, name, kind: task | send | report}`).
- The interface renders an attributed entry as an agent message: an amber block naming
  the sender, markdown-rendered, with a link to open that conversation. The prefix stays
  in the text for the model and is stripped for the reader.

### Two things this took

**Durable's view mounts only its own documents.** `acornfall.messages` is not among
`pi.agent`, `pi.live`, `pi.inbox`, `pi.usage`, so the interface cannot see it through the
view. The worker therefore annotates each view frame: `{type: "view", value, acornfall:
{senders}}`. Ours travels beside theirs.

**A commit that touches only our documents produces no view frame.** The mount does not
observe them, so the frame carrying the entry is emitted *before* the provenance is
written, and nothing announces the write. The first version recorded the provenance
correctly and the interface never learned it — the feature looked broken while the data
was right. The reporter now asks the worker to re-emit that conversation's view after
recording, which is what `DelegationDeps.notify` exists for.

**Control cached a frame by its value alone.** The cached `{value, seq}` is what a newly
attached client is handed, so the annotation was dropped for exactly the client that had
just connected — the case a browser reload hits every time. The annotation is cached
alongside the value now, and the reasoning is in the comment: a view frame is more than
its value.

`GET /api/conversations/{id}/messages` exposes the document, so attribution can be
checked without opening a browser. That endpoint is how the last of these was found.

## What is not built yet

- **Messages between conversations appear as `pi.user` entries.** The report text is
  prefixed (`[subagent lister finished] …`), which is what the model needs, and a human
  reads it correctly enough — but it is a text convention, not a structured field. A
  custom entry alongside it would let the UI render a chip instead of relying on the
  prefix. This matters more now that peers exist, because a peer's transcript shows the
  creator's message as if the user had typed it.
- **A tool phase that throws is now logged** (`onReport`) rather than silently
  vanishing. Before that, a reporter that failed left no trace at all: the run simply
  never continued.
- **No spend cap.** Wake-ups are bounded; tokens are not. A conversation can still
  spend without limit across its subagents, and per-conversation spend is only visible
  in the rail.
- **No isolation**: every conversation shares one working directory, so two agents
  editing one file will not notice each other. Accepted for now.
