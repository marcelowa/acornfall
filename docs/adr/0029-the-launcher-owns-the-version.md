# ADR 0029 — The launcher owns the product's version

Status: accepted, 2026-10-22; amended 2026-10-22 — the update completes by asking the host
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

## Amendment, 2026-10-22 — the update completes by asking the host

The decision above stops at a refusal: the product may tell, and may not act. What it left open is
the last line of Consequences — *"the update screen's copy still speaks of updating in place"* —
and the copy that replaced it was worse: run `acornfall machine up` on the host. That is an
instruction to leave the console, find a terminal and do the thing the button was for.

The host service ([ADR 0030](0030-the-host-supervises-the-machine.md)) is the other end. The rule
here is unchanged and the copy is not: the product still does not patch its own image — it declares
the release it wants in `state/host/want.json`, the service fetches and verifies that release,
makes a new disk and replaces the machine, and the console shows what the service says in
`state/host/is.json`. "Run `machine up` on the host" stops being the answer the screen gives.

What stays exactly as this ADR says:

- **One owner.** The host decides and acts; `Restart` and `Rollback` inside the machine still refuse
  with `ErrLauncherOwnsIt`, because both rewrite the binary the machine is running.
- **The product may tell.** The check, the notes, the dot and the picker remain, and the screen now
  has somewhere to put the answer.
- **A product on a host keeps the 0.9 path.** Without `--in-machine` nothing about this changes.

What changes is that "may not act" has a form a person can use: asking is not acting, and a
declaration in the mount is what asking looks like when the two sides are on either side of a
boundary that only carries files.
