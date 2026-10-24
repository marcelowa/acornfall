# ADR 0027 — The gateway is the machine's init

Status: accepted, 2026-10-22; amended 2026-10-22 — recovery is the host service, not a person
Date: 2026-10-22

## Context

The appliance boots by `exec`ing the gateway as PID 1: the machine's init **is** the product's
head. That is how it got built, not a decision anyone wrote down, and it has one visible
consequence — if the gateway exits, the machine exits with it, and nothing restarts it until a
person runs `machine up`.

Asked on 2026-10-22 whether to keep it or put a supervising init in front, the answer was keep it.
This records that it is now a choice.

## Decision

1. **The gateway is PID 1 of the machine.** No supervising init, no second process inside it.
2. **Recovery is `machine up`**, run by the person who notices the console is gone. There is no
   restart policy, because there is nothing to apply one with.
3. **A supervisor inside the machine is a new decision**, not a patch: it changes what the machine
   is, and the failure modes come with it.

## Alternatives

- **A small init that supervises the gateway.** A crashed head comes back and the machine stays up.
  Costs a second process with its own failure modes, a restart policy that has to distinguish a
  crash from a deterministic failure, and a second log to read when something goes wrong.
- **Let the engine supervise it.** The hypervisor knows the machine stopped, not why. Restarting on
  exit loops on a crash that will happen every time (a bad config, a missing path, a broken image).
- **systemd inside the image.** A second init, its units, its journals, for a machine that today has
  one process and one log.

## Consequences

- One process, one log (`/var/lib/acornfall/appliance.log`), one lifecycle. `machine status` is a
  real answer rather than one of several.
- A gateway crash takes every workspace with it. The console disappearing is the loudest alarm the
  product has, and the repair is one command.
- There is no "the API is up but the machine is broken" state to support, because the API is the
  machine's init.
- Anything that restarts the product has to be outside the machine: the launcher, or a person.

## Amendment, 2026-10-22 — recovery moved out of the person's hands

Decision 2 said recovery is `machine up`, run by whoever notices the console is gone, and that
there is no restart policy "because there is nothing to apply one with". There is now: the host
service ([ADR 0030](0030-the-host-supervises-the-machine.md)) is outside the machine, which is the
only place a policy can live, and it starts the machine at boot, restarts it when it exits, and
stops after a bounded number of restarts with a plain line in the log.

Nothing about the machine changed: the gateway is still PID 1, one process, one log. What changed
is who is watching it — a service that is meant to run under systemd or launchd, instead of a person
who happens to look.
