# ADR 0010 — One attachment per client, and the conversation in the URL

Status: accepted, implemented
Date: 2026-10-04

## Problem

The gateway attached to exactly one conversation and every client shared it. A second
browser tab therefore fought the first: whichever loaded last decided what both showed,
and a reload landed wherever the install happened to remember rather than where you were.

## The conversation belongs to the URL

```
/c/1276        a conversation
/              whatever this install used last
```

The client reads its conversation from the path, names it with `replaceState` on first
load, and moves with `pushState` when you pick another one. Two consequences worth the
change on their own: a shared link opens what it names, and the back button works.

Switching inside a tab **does not reload the page**. The tab clears its transcript, asks
for that conversation's state, and re-opens its stream against it. The browser check
proves it: a value set on `window` before a switch survives it.

## Attachments are per client, and reference counted

`Subscribe(conversationID)` rather than `Subscribe()`:

- A client names the conversation it wants, so two tabs can watch two conversations.
- The **first** watcher of a conversation is what asks the worker to attach it, because a
  worker subscription is what produces frames. The worker has always been able to watch
  many conversations at once — `viewState()` is per conversation — so nothing about it
  changed.
- The **last** watcher leaving detaches it again, except for the conversation this install
  remembers, which stays attached. Without that, every conversation ever opened would keep
  a live mount and keep emitting frames for the life of the process.

`State` became `StateFor(conversationID)`, and the event stream reports the state of the
conversation its subscriber asked for. So each tab's inspector, model picker, and policy
card describe its own conversation rather than a global one.

`GET /api/state` and `GET /api/stream` take an optional `conversation=`; omitting it means
the remembered one, which keeps every earlier caller working.

## Two things this exposed in the client

**Waking up must not rebuild the interface.** The lifecycle listeners added for stream
recovery called `loadState()` on every `focus`, which replaced the rail's elements under
the pointer: clicks were lost and the page felt haunted. They now act only when the stream
is silent or closed, and `focus` is not listened for at all — `visibilitychange` already
covers coming back to a tab.

**Lists that have not changed are not rebuilt.** The rail, the model picker, the agent
picker, and the thinking picker rebuild only when their contents change. Rebuilding a
`<select>` under an open dropdown closes it, and rebuilding a list under a pointer
detaches what it is about to click.

## A limit worth naming

Each view frame carries the **whole transcript**. That is 270 KB for a 121-entry
conversation, and during a run a frame is emitted per commit — around ten per second. It
is fine while idle and it will stop being fine for long conversations under load.

The fix is a cursor: the client says which entry it already has, and the frame carries
only what follows. The frames are already sequenced per conversation and the client
already tracks `seq`, so the shape supports it; what it needs is care about the cases
where the full value is still required — first attach, compaction, a fork, and the
inspector's "what changed since the previous request".
