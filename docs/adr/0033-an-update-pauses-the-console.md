# ADR 0033 — An update pauses the console until the machine and host are ready

Status: accepted, 2026-10-23
Date: 2026-10-23

## Context

An update is two steps (ADR 0031): the host replaces the machine, waits for its console to report a
worker ready, then replaces its own binary and exits so the supervisor starts the new one. The
console lives inside the machine, so during step one it disappears and the page reconnects to the
new one; during step two it stays up while the host changes underneath it.

The console only paused the update button. The composer, workspace creation, settings, and every
API client stayed live. A write during the machine swap reached a process that was about to die, or
failed with a connection error the person could not act on. The update screen was the only place
that knew something was happening, and it learned it from a `wanted`/`host` gap and a poll that
reported the expected outage as an error.

## Decision

1. **One derived phase, install-wide.** The update tier reports `idle`, `requested`, `starting`,
   `ready`, `failed`, with a target and a sentence. It is computed from the product's `want.json`,
   the host's `is.json`, and the build the gateway runs. No third file: the two sides already write
   the two facts.
2. **`requested` and `starting` block writes.** `requested` means the old console is up and the
   host is preparing; `starting` means the new console is up and the host service has not taken the
   release yet. `ready` and `failed` do not block. A block that outlives **15 minutes** becomes
   `failed`: a host that stops answering must not lock the console for ever.
3. **Only writes are refused.** `GET /state`, `GET /stream`, the update status, release list and
   notes, `/healthz`, and `POST /draft` stay open. The console needs them to report the phase; a
   draft is words, not a harness action. Every other write returns
   `409 an update to <target> is in progress (<phase>); actions are paused until it finishes`.
4. **The host step is part of the block.** `ready` requires both the machine and the host service
   to run the target. The host service only takes step two after the console reports a worker ready,
   so `starting` covers the machine boot and the host restart.
5. **The console obeys the phase.** While blocking, it shows an install-wide banner, disables the
   composer, new conversation, workspace creation/opening, and the update Install control; the
   transcript stays readable. The update screen says the phase; a failed status poll during the
   machine restart is the connection, not an error. The page follows the phase once a second while
   blocking, stops at `ready`/`failed`, and reloads for the new build as it already did.
6. **The machine-down window is reconnect-only.** The console is inside the machine; while the
   machine is gone there is no gateway to answer. The UI says "the machine is restarting;
   reconnecting" from the last phase and the connection. A host-served status page is a later
   feature, not part of this decision.

## Consequences

- A second Install, a prompt, a workspace write, or a settings write during an update is a `409`,
  not a connection error or a half-write.
- A failed update lifts the block. The machine that is up is usable, and the update screen carries
  the host's sentence; the person can retry or roll back.
- An API client that sends a write during an update must wait and call the state/status again. The
  phase and target are in both the update status and the stream summary.
- A client from before this ADR has no banner; it still gets the `409`. The new console, once the
  new machine answers, has the full behaviour. The end-to-end proof is therefore beta.47 → beta.48.
- A host install whose files are swapped but whose process is old reports `requested` from
  `restartRequired`; the same guard applies until the restart.

## Alternatives

- **UI-only pause.** Rejected: the gateway is the product's edge, and an API client or a second
  tab would keep writing into the machine being replaced.
- **Block reads too.** Rejected: the console cannot report the phase if state, stream, and status
  are refused.
- **Block indefinitely.** Rejected: a dead host becomes a console no one can use. The fifteen
  minutes is the bound, and the failure is visible.
- **A host-served status page during the machine window.** Useful, but a second surface and a second
  owner of the phase; the reconnect-only window is accepted for 0.10.
