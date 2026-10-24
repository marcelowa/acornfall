# ADR 0031 — An update is two steps, and the host takes the second one

Status: accepted, 2026-10-22; amended 2026-10-23 — the first start claims the boot marker
Date: 2026-10-22

## Context

ADR 0029 gave the host the version and ADR 0030 gave the product a way to ask for one. What neither
answers is the host's own version: the service that supervises the machine is a binary on the host,
and until now nothing updated it but a person replacing it by hand.

The obvious shape is wrong, and the two betas that shipped without a proof (ADR 0024) are the reason
it is obvious: **the thing that replaces the machine is the thing that has to still work when the
machine does not.** A release that boots a bad appliance is repaired by a good host binary; a release
that also replaces the host leaves nobody to do the repairing. Updating both at once, or updating the
host first, is an update that can take away its own rescue.

## Decision

1. **An update is two steps, in this order.** Step 1 is the machine, already built (ADR 0030's apply).
   Step 2 is this host's own binary, taken automatically — but only for a release step 1 has proved
   *on this host*.
2. **The evidence that earns step 2 is readiness, and it is one condition, asked on every tick**
   after an apply:

   ```
   step 2 happens when  the engine says the machine is running
                   AND  the machine's state reports a worker ready
                   AND  the release the machine runs is not the version this service is
   ```

   The first tick all three hold is the tick the host swaps and exits. There is no timer, no settle
   window, no flag for one, and no record of evidence: nothing is written that could go stale. A
   machine that is running but has no worker behind it does nothing and is asked again next tick —
   readiness is the gate, not time. A machine that stops does nothing at all.
3. **The exposure this accepts.** Step 2 takes a release that has been seen ready **once**, so a
   release that fails later fails on both sides. The net is not a delay any more. It is the previous
   binary kept beside the symlink, the boot marker that undoes a binary which cannot start, and
   `StartLimitBurst` on the unit — and a person can point the symlink back at the previous binary with
   no network at all.
4. **The swap has two phases, so a binary that cannot start undoes itself.** Verify the release's
   checksum file covers this host's binary and matches the bytes; write `bin/acornfall-<tag>` (0755,
   temp and rename); write the boot marker; point the owned symlink at it (a new link renamed over the
   old one); exit 0. The supervisor starts the new binary. The keep is the last two binaries, so the
   one before a failed attempt is still there.
5. **A start that finds its own marker goes back.** Before anything else, the service reads the marker:
   if it names the version this binary runs, the previous start never reached ready, so the symlink is
   pointed at the binary before it, the marker is removed, and the process exits 1. The supervisor
   starts the old one. A marker naming another version is stale and is removed. A binary that reaches
   ready — one full tick, the machine read and `is.json` written — removes the marker.
6. **The service replaces only a binary it put there.** `~/.acornfall/bin/acornfall` is the contract
   with the unit files: the versioned binaries live beside it and the symlink names the current one. A
   service started from anywhere else — `/usr/local/bin`, `~/.local/bin`, a package manager's tree, a
   checkout — supervises and applies the product's releases, and refuses to update itself, with one line
   in the log and `is.json.lastError` naming the path it expected. Writing a binary we did not install
   is how a package manager's tree is corrupted.
7. **One update at a time per host.** `state/host/update.lock` holds a pid and a time; `machine update`
   and the service's automatic step 2 both take it, because they write the same binary and the same
   disk. A lock whose process is gone, or one older than any update this host does (an hour), is stale:
   it is broken with a line in the log, because a crashed update must not stop the next one for ever.
   A live lock is a refusal naming the pid and the time, not a wait.
8. **`acornfall machine update` runs both steps now**: resolve the release (the tag it is asked for, or
   the newest), step 1, wait for the machine's state to report a worker ready, step 2. It stops between the
   steps when the console never answers, with a sentence naming which step was not taken. `--machine-only`
   does step 1 and exits. After it, the service only has to restart into the binary the command put in
   place, which it notices from the symlink alone — no second download.
9. A release whose host binary is missing for this OS/arch, or whose checksum does not cover it, is not
   a fault to retry every tick: it is logged once, held like any failed step 2 (the same delay as a
   failed apply), and said in `is.json.lastError`. The service keeps serving.

## Why the order is the safety

A release reaches the host only after the machine has run it and reported a worker ready on this host.
Every failure mode that step 1 can have — a bad appliance, a container runtime that will
not start, a console that never comes up — leaves the host binary exactly as it was, and that binary is
the one that can put the machine back. The reverse order would mean a release could take the rescue
away before anything had shown it was safe.

## Alternatives

- **A person triggers step 2.** Rejected by the owner as too manual: the update that a person asked for
  in the console should finish without them finding a terminal, and a step that is always done by hand
  is a step that is skipped or done in the wrong order.
- **Self-update with no evidence** (take the release as soon as the machine has it). Rejected: a broken
  release would take the rescue with it, and the host is the one thing that cannot be recovered from
  inside the machine.
- **The supervisor updating itself with no rollback marker.** Rejected: a binary that cannot start is a
  restart loop with no diagnosis. The marker is what turns that into one failed start and a binary that
  goes back.
- **A settle window** — wait N minutes after the machine is ready before taking the release. Considered
  and rejected by the owner: ten minutes would make a *fix* release wait on the host while the machine
  already had it, which is the update a person is least willing to wait for. It is the first knob to add
  if a release ever misbehaves in the field, and it is one constant and one comparison, not a rewrite.
- **A package manager, or a person, owning the host binary.** Still possible, and then step 2 is not
  taken: the owned-path rule is what makes both shapes coexist without the service writing into a tree
  it does not own.

## Consequences

- Both halves of an install are now updatable from the console, in the order that keeps the repair.
- The service can exit on purpose, and the unit's `Restart=always` is what brings it back on the new
  binary. `StartLimitIntervalSec=60`/`StartLimitBurst=3` in the systemd unit is the other half: a binary
  that cannot run at all goes to `failed`, which is a state a person can read, instead of restarting for
  ever.
- A host whose service was started from a path it does not own keeps updating the machine and never
  itself. That is a decision, visible in `is.json`, not a silent difference.
- The marker and the lock are files under `state/host/`, beside the channel (ADR 0030), because that
  is the one folder both sides already write and a person already reads. There is no evidence file:
  readiness is read from the machine, not remembered by the host.
- `machine update` prints the command that restarts the service rather than running it: the unit is a
  person's file, in whatever init that host uses, and a command that calls `systemctl` assumes one.
- Open, and named as the accepted exposure above: a binary that starts, serves, and then misbehaves has
  no automatic trigger. The marker covers binaries that cannot run; nothing covers one that runs badly.

## Amendment, 2026-10-23 — the first start claims the boot marker

Decision 5 as written made every host update undo itself. The swap writes a marker naming the new
version, and the first start of that version read the swap's own marker as "the previous start never
reached ready", pointed the symlink back, and exited 1. The old binary then saw the machine ready,
swapped the new one in again, and the two starts repeated until systemd's burst limit left the
service failed. This happened on the beta.43 to beta.44 update.

The marker now has two phases. The swap writes it unclaimed (`started: false`). The first start of
the new binary claims it (`started: true`) and continues. Only a later start that finds it claimed
knows an earlier start of this version did not reach ready, and that start goes back. The rollback
the decision promises is unchanged; the first start is no longer mistaken for the failure it is
supposed to detect.
