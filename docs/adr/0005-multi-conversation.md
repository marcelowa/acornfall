# ADR 0005 — Multiple conversations

Status: accepted, implemented
Date: 2026-10-04

## Problem

The first build had exactly one conversation and a hardcoded label, `"root"`, used as
the conversation id in every command and frame. It worked only because there was one
conversation, and it contradicted ADR-0001, which says a conversation *is* what the user
sees. Two things had to change together: real identity, and the word "session", which
meant both "transcript" and "something process-shaped" and therefore meant neither.

## Identity

**A conversation id is the harness's own id, stringified, and is opaque above the
worker.** pi-durable's `ConversationId` is a branded number; the wire carries it as a
string; control never parses, orders, or constructs one beyond passing it back.

This is what keeps the harness replaceable: a future worker with UUID ids, or a Go
harness with its own scheme, needs no change in control, the gateway, or the client. The
local label existed because it was convenient, and convenience is exactly how a
placeholder becomes load-bearing.

## Listing

`storage.scanConversations(...)` is public. The filter that matters is not in the query:
**a conversation with no `owner` edge is a user conversation; one with an owner is a
subagent's transcript.** Without that filter the user's list would fill with agent
chatter the moment subagents exist.

Titles are derived, because `ConversationRecord` carries an id and ownership but no name:
the first `pi.user` entry, collapsed and truncated. Lists are refreshed after a run
settles, since that is when a title can change. This is O(conversations × entries
scanned) per list; at a handful of conversations that is free, and a title document or
index is the fix when it stops being free.

## Attachment

Control attaches to **one conversation at a time** in v0: `Select` detaches the previous
and attaches the new one, so frames describe a single transcript. Frames still carry
`conversationId`, so the invariant survives when a client subscribes to several.

The last full view per conversation is cached in control. Switching back therefore
renders instantly from the cached snapshot instead of waiting for the worker's next
frame, and the client clears its transcript on switch so it can never show one
conversation's entries against another's id.

## Per-conversation agent

Agent bindings moved from one binding per process to one per conversation, persisted in
`settings.json` as `{ active, agents: { "<id>": binding } }`. Two consequences worth
stating:

- Selecting a conversation **adopts a model if it has none**. A conversation with no
  model fails on its first prompt, and "it silently did nothing" is the worst failure
  mode; this also healed conversations created before the fix.

- A partial update (for example only a thinking level) must not blank the model. The
  resolution order is: explicit in the request, then the definition's model, then the
  conversation's existing model, then the install default.

## Thinking level

The level picker is populated from `getSupportedThinkingLevels(model)`, so a
non-reasoning model offers only `off` and cannot be given a level that does nothing. A
definition may set a level; an explicit choice in the picker beats it.

## Routes

Conversation-scoped, with the conversation in the path:

```
GET  /api/conversations              POST /api/conversations
POST /api/conversations/{id}/select
POST /api/conversations/{id}/messages
POST /api/conversations/{id}/abort
POST /api/conversations/{id}/agent
```

There are no conversation-less routes. The single-conversation build's `/api/messages`,
`/api/abort` and `/api/agent` were removed rather than kept as aliases: nobody had
scripted against them, and a compatibility shim with no known client is just a second
way to do the same thing.

## What is still missing

- No rename and no delete. Both are wanted; neither is designed.
- No fork from the UI, though `conversation.fork(at, options, context)` exists and is
  most of the way there.
- ~~One attached conversation per gateway instance.~~ Done: attachments are per client and
  reference counted, and the conversation lives in the URL. See
  [ADR 0010](0010-per-tab-attachments.md).
- A client that attaches mid-run gets the cached view immediately, which is correct, but
  has no cursor: it cannot ask for "everything since seq N". That matters when the
  gateway restarts, not yet.
