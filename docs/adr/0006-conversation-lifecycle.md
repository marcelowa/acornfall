# ADR 0006 — Conversation lifecycle: rename, fork, delete

Status: accepted, implemented
Date: 2026-10-04

## Rename

`ConversationRecord` carries an id and ownership but no name, and titles were derived
from the first user message. A derived title cannot be edited, so a name has to be
stored.

**It is stored in a durable document committed into the conversation**
(`acornfall.meta`, an ordinary conversation-scoped doc with `history: latest` and
`fork: initial`), not in control's settings file.

Why not settings: settings are ours, the transcript is the harness's. A name in our file
would be a second source of truth for something the conversation owns, it would vanish
if our configuration were lost while the transcript survived, and it would need its own
answer for forks, exports, and reimports. As a document it inherits all of those from
the same rules as `pi.agent` and `pi.usage`, and `HarnessOptions.conversationCreated`
seeds it in the creating commit, so every conversation has metadata from its first entry.

An empty name means "no name given", and derivation still applies. Renaming to empty
therefore reverts to the derived title rather than blanking the row.

## Delete

**Storage is append-only and has no delete.** The `Storage` interface offers `commit`,
`conversation`, `scanConversations`, entries, tasks, and submissions — nothing removes
anything. That is the invariant ADR-0001 rests on: commits are durable facts, and a
transcript that could lose entries would make the log untrustworthy as the basis for
compaction, context edits, usage accounting, or self-improvement.

So delete is a **tombstone**: `hidden: true` in the same metadata document.

- The conversation leaves the list and cannot be selected.
- Its transcript, usage, and documents are untouched.
- It is **restorable from the UI**, under a collapsed "Deleted (n)" section.
- Hiding the conversation you are looking at moves you to another visible one, or
  creates one if none remain, so the UI can never point at something it just hid.

A row-level delete was possible with direct SQL against the storage file. It was
rejected: it would bypass task references, break the append-only guarantee only for the
case we could test, and destroy something the user cannot get back for a button labelled
with a single character.

Consequence to be honest about: a hidden conversation costs disk space forever. Purging
is a separate feature — it needs to decide what happens to tasks, documents, and entries
referenced from elsewhere, and it should not be smuggled in behind a trash-can icon.

## Fork

`conversation.fork(at, options, context)` exists and does the work: the fork sees its
parent's entries up to `at` and continues independently, inheriting the agent in effect
at that point. Control copies the parent's binding to the fork so the picker agrees with
what the worker already applied.

Two UI decisions:

- **The branch button sits on a user turn and forks at the entry *before* it.** Forking
  *at* the user entry would leave the fork with a trailing unanswered message, which is a
  state nothing else in the UI produces. Forking before it gives a conversation that is
  simply waiting for a prompt.
- **The branched message is handed back into the composer**, so the point of branching —
  asking the same thing differently — is one edit away instead of retyping.

The fork is named `Fork of <parent title>`, written at fork time rather than derived, so
it is identifiable even though it inherits the parent's transcript and would otherwise
derive the parent's title.

## Routes

```
POST /api/conversations/{id}/rename   { title }
POST /api/conversations/{id}/hide     { hidden }
POST /api/conversations/{id}/fork     { at }        // entry id
```

## A bug this shipped with, and the lesson

`hidden` was declared `json:"hidden,omitempty"` in the Go command struct. Go therefore
omitted it when the value was `false`, the worker saw `undefined`, and restoring a
conversation **did nothing while reporting success**. A boolean that carries meaning in
both directions must not be `omitempty`; `false` is a value, not an absence.

## Still missing

- No purge, as above.
- No bulk operations: deleting ten conversations is ten clicks.
- Forking from the UI is only offered before user turns. Forking at an assistant message
  is supported by the worker and not exposed, and it is the natural place for "branch
  from this answer".
- Renaming does not touch the derived title of forks already taken from it.
