---
name: refactor-ux-11-final-pass
description: Take the owner's own notes and last fixes, now that the panel has approved the look. Step 11 of the refactor-ux chain.
---

# The owner's final pass

## When to use it

Right after step 10, same session. Never earlier, however tempting the notes are.

## The playbook

1. **Ask the user for their remaining notes now** — the first point in the chain where personal
   taste, not the personas, is the input.
2. **Apply them**, keeping the approved journeys, palette, and consolidated structure unless a
   note explicitly overrides one.
3. **Say so plainly when a note fights something the panel approved**, before applying it. It
   stays their call, but not a silent one.
4. **Re-run the checks after the last change** (`bun run typecheck`, `bun test`, `make lint`, `make
   ui-build`) and write the outcome to `docs/ui-workflow/refactor-ux/11-final-pass.md`.

## Exit gate

- [ ] the user's notes are applied, or declined with a stated reason
- [ ] the checks still pass

Then invoke `refactor-ux-12-finalize-docs`.

## Why this matters

Notes taken before the panel signs off let taste beat evidence the chain spent ten steps gathering.
Taken last, they are polish on a validated direction.
