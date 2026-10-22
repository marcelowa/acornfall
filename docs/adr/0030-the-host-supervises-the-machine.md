# ADR 0030 — The host supervises the machine, and the product declares intent

Status: accepted, 2026-10-22; amended 2026-10-22 — a person's intent is a file too (below)
Date: 2026-10-22

## Context

The product runs inside the machine (ADR 0022), so the thing that can replace the machine is the
launcher on the host. Two decisions ran into that wall.

[ADR 0029](0029-the-launcher-owns-the-version.md) says the launcher owns the version: the product
may tell, may not act. The update screen therefore refused with a sentence telling a person to run
`acornfall machine up` on the host. The refusal is correct and the copy is an instruction to leave
the console, find a terminal, and do the thing the button was for.

[ADR 0027](0027-the-gateway-is-the-machines-init.md) says the gateway is PID 1: if it exits, the
machine exits, and nothing restarts it until a person runs `machine up`. That is a machine that is
down until someone notices.

Both want the same missing piece: a host-side process that keeps the machine up and applies a
release the product asked for. The question this file answers is only about the *channel* between
the product and that process — the door the update screen used to be on the wrong side of.

## Decision

1. **`acornfall machine serve` is that process**, in the same binary as the launcher. It does two
   things and no more:
   - **supervise**: start the machine if it is not running, restart it when it exits, with backoff
     and a cap, and stop after N with a plain line in the log. A deterministic crash is a process
     that must not loop silently for a week.
   - **reconcile**: apply the release the product declares, one per tick.
2. **The channel is declared intent and observed state, over the mount.** Two files, no
   connection, no ids:

   ```
   $ROOT/state/host/want.json      written by the product
     { "version": "v0.10.0-beta.14" }

   $ROOT/state/host/is.json        written by the service
     { "running": true, "version": "v0.10.0-beta.13", "service": "v0.10.0-beta.13",
       "lastError": "", "at": "2026-10-22T09:41:00Z" }
   ```

   Both are written atomically — a temporary file in the same directory, `fsync`, `rename` over —
   because a reader that sees half a file is a decision made on garbage. The reader tolerates a
   missing file, an empty file and a file it cannot parse: each is "nothing declared yet", never a
   failure.
3. **`want.json` is untrusted.** The mount is writable by the product, so the service treats every
   byte as hostile: `version` must parse as a release tag (`vX.Y.Z[-suffix]`), and the tag must
   exist in the release list before anything is fetched. Unknown fields are ignored; anything else
   is refused by name in `is.json.lastError`. **There is no field that names a path, a command, an
   environment variable or a URL, and there must never be one.**
4. **The service acts on the gap, on a ~1s tick.** `want.version` differs from the running
   release: fetch and verify that release's tarball (ADR 0026, amended), make a new disk from it,
   replace the machine. `want.version` absent or empty: change nothing. A failed apply leaves the
   running machine untouched and names the failure in `is.json.lastError`; **an update that fails
   must never leave an install with no machine.**
5. **Three verbs, and no fourth.** `status` is `is.json` itself; `apply` is `want.version`; restart
   does not exist in v0 (below). There is **no "run this command" verb**: it would hand away the
   sandbox's promise — the mount is the one thing the machine's containers can reach, so a channel
   that carries a command line is a channel that runs a workspace's command on the host.
6. **`machine restart` on the host stays the deliberate path**, and the service's own restart of an
   exited machine is its supervision, not a verb.
7. **The product's side is the screen, not a loop.** The update screen writes `want.version` and
   then shows what `is.json` says: the release asked for, the release running, and the last error
   when one failed. The gateway reads `is.json` when it builds its state — it already builds one per
   frame — so the browser polls nothing new. ADR 0029's rule stands, and its copy changes: the
   product does not patch its own image, it asks the host.

## Why not request and reply

The first sketch was a mailbox: the product writes `requests/<id>.json`, the service writes
`replies/<id>.json`, with ids and a timeout. Every part of that is a problem this does not have:

- **An id has to be agreed on and kept** — by both sides, across two independent restarts, and it
  has to not collide. Declared intent has no id because there is nothing to correlate: the state
  itself is the answer.
- **A reply can be lost, and a timeout cannot tell "not done" from "lost".** A 200 MB fetch behind
  a slow link takes minutes; a timeout long enough for that is a screen that hangs, and a timeout
  short enough is a lie. Intent and observed state have no timeout: the screen reads the gap
  whenever it is drawn.
- **An operation is idempotent when it is a state, and not when it is a message.** Repeating
  `apply v0.10.0-beta.14` is a no-op once that release is running; a second identical request is
  a second apply unless someone tracks ids.
- **Both sides restart.** The machine restarts on every update and the service restarts with the
  host. A mailbox with ids has to survive that — a request written before the crash, a reply lost
  with it — and a declared state is just a file that is still there afterwards.
- **The intermediate state is what an update screen should show anyway.** "Asked for beta.14,
  running beta.13, fetching" is three fields in a file. A request/reply channel has to invent a
  vocabulary for that and then render it.

## Why not the vsock door yet

The engine can publish a host socket into the machine over vsock, and the shim already proves the
mechanism (`docs/engineering/container-shim.md`). Two reasons it is not this channel:

- **The door must exist before the machine is created** — it is part of the machine's own
  configuration, and the shim's documented lesson is that a listener has to be up first or the
  machine dials into nothing. A channel that has to be wired before the thing it updates is a door
  that an update cannot repair: the machine that is stuck cannot be replaced over a door that only
  exists inside it.
- **It would tie the channel to engine support on every host**, and to a listener the launcher has
  to keep alive across the update itself — the one moment the process is being replaced.

The mount already carries the product's state and is the crossing ADR 0022 chose; a channel over it
needs nothing from the engine and survives both ends restarting. The door stays available for
something that needs a stream, which this does not.

## Restart: omitted, not forgotten

There is no restart verb in v0. An update is a new machine, so the case "restart the machine I have"
is thin, and a verb nobody needs is a surface that has to be validated forever. The trigger for
adding it is named so the omission is a decision: **a second request in one day for a restart the
supervisor is not already doing** — a machine that is up but wedged, where a person wants the
process restarted without changing the release. It would be `want.json`'s second field
(`{"restart": "<timestamp or intent>"}`), not a request id, and it would be added with the same
validation rule: a value the service can refuse by name.

## Alternatives

- **No supervisor; the product keeps telling a person to run `machine up`.** The machine stays down
  after a crash until someone notices, and an update is a wall of copy instead of a button. Both
  failures are the ones this exists to remove.
- **The service runs a command the product asks for.** Any command, once the door is open: it would
  be the host executing what a workspace can write. Refused outright — see decision 5.
- **Put the supervisor inside the machine** (a second init, ADR 0027's alternative). It cannot
  replace the disk it is running from, and a supervising init that restarts PID 1 forever is the
  loop with no cap.
- **The engine's own restart policy.** The hypervisor knows the machine stopped, not why; a crash
  with a bad config would restart at every boot with nothing counting it.

## Consequences

- A crash comes back by itself, and the count is bounded: the log says how many times and then
  stops.
- An update finishes where it was asked for. The screen shows two versions and the gap between
  them, which is the only honest progress report an apply can give.
- The service is one process per install, and it is the thing that touches the machine: two of them
  fighting over one disk is a state the design does not support. `machine serve` is meant to run
  under systemd or launchd (`scripts/units/`), which is what makes it start at boot.
- The mount carries the channel, so the same reach that makes a privileged workspace able to read
  the key makes it able to write `want.json`. What it can write is a release tag, validated, and a
  tag that does not exist is refused before anything is fetched. That is the whole surface.
- `machine up` stays the deliberate, one-shot form of the same work; it is not removed and it does
  not ask the service.
- Open: the service's own update (who replaces the replacer) is the same question as the launcher's,
  and it is still open in ADR 0022's consequences.

## Amendment, 2026-10-22 — a person's intent is a file too

The design above gave the *product* a way to say what it wants, and left the other question to the
service: should this machine exist at all? The service answered it by always wanting a machine.
`machine down` removed the disk and the next tick made one again, so a command that reported success
was undone within a second. The missing piece is the same shape as the one this file chose for the
product.

1. **Two intents, two files, one service.** The product's release is `state/host/want.json` inside
   the mount (above). A person's is `state/machine.json` on the host:

   ```
   ~/acornfall/state/machine.json   written by a person's command
     { "wanted": "running" }        one of: running, stopped, gone
   ```

2. **The commands write it, before the work they describe.** `up` and `restart` write `running`,
   `stop` writes `stopped`, `down` writes `gone`. A boot interrupted half way leaves the intent
   behind, which is the point of a file over a flag; `restart` declares `running` *before* its down
   half, so a failure between the two does not leave a machine the service believes nobody wants.
3. **The service enforces it and never sets it.** `machine serve` reads that file and writes nothing
   to it. Only `running` makes it start, restart or boot a machine, and it is one function that
   answers the question — the start path, the restart path and the boot after an apply all ask it,
   so there is no second place for the rule to drift. Backoff and the cap apply only to a machine
   that should be up: a machine a person stopped is not a crash loop.
4. **Missing, empty or unparsable is "nothing declared", with no error.** That host is a host where
   a person drives, which is what an install was before there was a service: nothing is started, the
   product's release is still applied, and the state is still reported.
5. **`down` is final until someone says `up`.** A machine taken down does not come back because a
   tick happened, and it does not come back because an update arrived. The service builds nothing for
   a machine nobody declared running — no fetch, no unpack, no disk — and the product's request waits
   in the mount, which `down` does not touch, until a person says `up`.

**Why the service is the enforcer and never the owner.** A process that starts a machine because it
is written to start one cannot be told to stop; a process that enforces a file can. Every question
this service answers — is the machine running, which release is it, should it exist — has an author
that is not the service: the engine, the disk, and a person. The one thing it owns is the loop.

**The consequence worth stating plainly**: `machine down` now reports something that stays true. The
cost is that a machine taken down is not brought back by anything but a command, so a person who
takes a machine down and expects an update to bring it back is wrong — and the screen shows which
release was asked for, and that nothing is running under it.
