# ADR 0009 — Liveness, keepalive, and worker recovery

Status: accepted, implemented
Date: 2026-10-04

## Problem

Two reported symptoms — "the interface disconnects too easily and does not come back",
and a rail marker nobody could interpret. The first turned out not to be a UI problem at
all.

## A dead worker looked exactly like an idle one

Reproduced by killing the harness process: every read the gateway serves comes from its
own cache, so `/api/state` and the event stream kept answering normally. The interface
showed a healthy, idle application with no backend. Only a call that had to reach the
worker failed, and nothing in the UI was making one.

So the gateway could not tell "quiet" from "dead", and neither could anything watching it.
Fixed at the source:

- **`Worker.OnExit`** — the process is reaped once, and its end is an event rather than
  something the next call discovers by failing.
- **`State.workerUp` and `State.workerError`** — the interface is told. The status pill
  reads "harness down" with the reason, instead of "idle".
- **A supervisor restarts it.** Work is committed before it is shown, so a fresh process
  resumes every run from its last commit; recovery re-reads the catalog, re-attaches the
  conversation a client is watching, and re-applies its agent. Measured at two seconds.

### The supervisor is one loop, not one per death

The first version started a restart loop from the death handler, so every failed attempt
was another death and another loop: attempts compounded instead of backing off. The
supervisor now owns the lifecycle and is the only reader of a single `workerExited`
notification; five consecutive failures back off to a sixty-second retry rather than
burning the machine on a crash loop.

`exec.Cmd.Wait` is called from a reaper goroutine, which is documented as unsafe while a
pipe is still being read, so the stdout reader remains the thing that ends; the reaper
only announces it.

## The stream had no heartbeat

An idle `text/event-stream` is indistinguishable from a dead one until something times
out, and a hidden tab is exactly where a connection dies without an error. The handler now
sends `retry: 3000` and a `: keepalive` comment every fifteen seconds, and the client:

- tracks the time of the last event, including the keepalive;
- reconnects when the stream has been silent for forty seconds, because an `EventSource`
  that is dead without having fired an error otherwise leaves the display showing state
  that stopped being true minutes ago;
- reconnects and re-reads state when a hidden tab becomes visible, since that is the case
  the report came from.

Reconnecting is safe because every frame is a complete view and the server sends the
current state and view on subscribe: there is no delta to have missed.

## The rail marker was a third meaning for one shape

Conversations an agent created were marked with an amber dot. Dots already meant *running*
and *unread* in that rail, so a third colour with no label was three meanings for one
shape — the reported confusion was the design telling the truth.

Identity is text, and already was: the id renders as `1290 ·root`. A peer now renders as
`1290 ·peer`, in the same place and style. **Dots are for live state; text is for
identity.** The sender of a message is likewise named in words rather than encoded as a
colour.

## Verified

```
kill -9 the worker →
  gateway log:  worker died: the harness process ended: signal: killed
                worker restarted and resumed          (2s later)
  /api/state:   workerUp true
  browser:      idle

with restarts made to fail:
  /api/state:   workerUp false, "the harness process ended: exit status 1"
  browser:      "harness down", tooltip carries the reason
```

## What this does not do

- **No supervision of the gateway itself.** If the gateway dies, nothing restarts it; that
  is the supervisor of the supervisor and belongs to systemd or a container, not to us.
- **A restart loses in-flight streaming**, though not work: the last ~100ms of a partial
  answer is gone, and the transcript resumes from the last commit.
- **Recovery does not re-attach every conversation**, only the one a client is watching.
  Subagents running in the background are unaffected, because their tasks are durable and
  the worker resumes them on open.
