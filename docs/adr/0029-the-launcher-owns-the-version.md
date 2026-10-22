# ADR 0029 — The launcher owns the product's version

Status: accepted, 2026-10-22
Date: 2026-10-22

## Context

0.9's product updated itself: check, download, swap the binary, exec, roll back if it does not come
up (ADR 0019). 0.10 moved the product inside a replaceable image (ADR 0026): the launcher fetches
the release's appliance, verifies it and makes a new machine.

Both paths still exist. Inside the machine the console can still apply an update — it writes a new
binary into the image and re-execs itself — and the next `machine up` replaces that image, because
the image's mark still names the old release. The update vanishes with nothing said, and until it
does, the image holds a binary from one release under a mark that names another.

Asked on 2026-10-22 who owns the version, the answer was the launcher.

## Decision

1. **In the appliance, the launcher owns the version.** `machine up` on the host *is* the update:
   it replaces the image and makes a new machine.
2. **The product may tell, and may not act.** The release check, the notes, the dot and the picker
   stay. `Apply`, `Restart` and `Rollback` refuse with `ErrLauncherOwnsIt`, naming the command that
   does work, and the update screen's request comes back as a conflict carrying that sentence.
3. **A product running on a host keeps the 0.9 path.** Without `--in-machine` the binary is the
   thing the person installed, and it may replace itself.
4. **The rule is expressed once**, where `--in-machine` is known: the manager is built with a
   launcher as its owner, and every way to change the version asks the same question.

## Alternatives

- **Let the console own it, and stop replacing the image.** The base Debian tree is then never
  refreshed, the image drifts and accumulates, and the mark has to be rewritten from inside the
  thing it describes. That is the pollution class with a promise on top.
- **Both, coordinated**: the in-machine updater stamps the mark after applying, so the launcher
  keeps what it applied. Feasible, but two paths must agree forever and the base still never
  refreshes.
- **Hide the screen in the appliance.** Cheaper to explain, and it removes the screen's reason to
  exist: telling a person a release exists and what changed.

## Consequences

- One owner, one command, one place a version comes from. The console answers "how do I update?"
  with the command that does it.
- An appliance image can no longer be mutated by the product running inside it — the same rule as
  ADR 0026, seen from the inside.
- The two shapes now differ in exactly one place, and a flag names it.
- The update screen's copy still speaks of updating in place: the refusal is correct, the wording is
  the remaining piece of this decision.
