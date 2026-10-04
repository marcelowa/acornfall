# ADR 0001 — Concepts

Status: accepted
Date: 2026-10-04

We adopt the vocabulary of `@earendil-works/pi-durable` verbatim, so that upstream
source and documentation can be read without translation. Four terms are ours; they
are marked below.

## Vocabulary

| Term | Meaning | Owner |
|---|---|---|
| **Harness** | One open storage plus the machinery that runs agents on it. | worker |
| **Storage** | The durable backend holding conversations, entries, documents, tasks. | worker (path chosen by control) |
| **Conversation** | One transcript. A stateless handle, compared by id. Its id is the harness's own, and is opaque to control. | worker |
| **Entry** | One immutable transcript record (`pi.user`, `pi.assistant`, `pi.tool-result`, `pi.system`, `pi.reset`, custom kinds). | worker |
| **Commit** | An atomic write. Nothing is shown before it is stored. | worker |
| **Document** | Typed JSON state committed beside the transcript (`pi.agent`, `pi.live`, `pi.inbox`, `pi.usage`). | worker |
| **Task** | A durable state machine that checkpoints every step (`pi.generation`, `pi.tool`). | worker |
| **Submission** | An input handed to a conversation; resolves `done` or `unanswered`. | worker |
| **Turn / Run** | Turn = one model response plus its tool calls. Run = an input through to its final answer. | worker |
| **Extension** | A named bundle of tools, sections, hooks, wraps, tasks. | worker |
| **Registry** | The extensions installed in one process. | worker |
| **Agent** | Resolved: model, thinking level, extensions, tools, instructions, cwd. Stored as names; resolved per request. | worker |
| **View / watch** | Committed structural state, plus the operations of each commit. | worker → gateway |
| **Usage** | Token and cost totals per provider/model and per tool. | worker → control |
| **Workspace** | *(ours)* A folder plus metadata. Owns one worker and its conversations. | control |
| **Worker** | *(ours)* The process owning one Harness. | control |
| **Attachment** | *(ours)* A client's live subscription to one conversation's frames. | gateway |

## The three mappings that decide the shape

**A conversation is the unit the user sees.** It is not a process, a storage, or an
agent, and it is not called a session: that word meant two different things here —
a transcript and something process-shaped — which is how a hardcoded placeholder id
survived review. Everything the user thinks of as "a chat" is a Conversation id.

**Workspace = one Worker = one Harness = one Storage.** All of a workspace's
conversations, and all the subagent conversations they spawn, live in one SQLite
storage, because task ownership and the task graph require it. A worker crash therefore
affects every conversation in the workspace, and every one of them resumes from its last
commit: the cost is recovery latency, not lost work.

**Subagent = child Conversation owned by a Task.** Delegation is not a separate
subsystem; it is `tx.createConversation({ ownership: { kind: "task", taskId } })`.
Ownership is also the discriminator that keeps subagent chatter out of the user's
conversation list: a user conversation has no owner edge.

## Invariants

1. **Durable facts and live frames are separate channels.** Entries and documents are
   durable. Streaming partials and status are not.
2. **Nothing reaches the UI before it is committed.** The client's state is always a
   projection of stored state.
3. **Stored agent configuration is names, never code.** Conversations store extension
   names and model refs; the registry resolves them at use. Reload and upgrade cannot
   rewrite history.
4. **The agent resolves per request, not per conversation.** Changing a conversation's
   model, tools, or cwd applies from the next request and can reach calls already in
   flight.
5. **A conversation id belongs to the harness.** Control treats it as opaque, so a
   replacement worker with a different id shape needs no change above it. Inventing a
   local label for it is how two identities for one thing get into a codebase.

## Consequences

- Our conversation list, transcript rendering, and fork come from durable's view, not
  from a second store we maintain.
- Control owns no transcript. It owns identity, resources, credentials, and policy.
- Anything we add must answer "is this durable, or is this a live frame?" before it is
  designed.
