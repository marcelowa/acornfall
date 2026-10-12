---
name: refactor-ux-09-build
description: Build the approved direction for real, journey by journey, against the confirmed goal, journeys, palette, and approved mocks — not a fresh interpretation of them. Step 9 of the refactor-ux chain.
---

# Build it for real

## When to use it

Right after step 08, same session, never standalone.

## The playbook

1. **Re-read, don't re-derive:** `docs/ui-workflow/refactor-ux/02-goal.md`, `03-journeys.md`,
   `05-palette.md`, and the approved mocks. This step executes those decisions.
2. **One journey at a time.** Build it, compare it against its mock, then start the next — not
   everything, then one comparison at the end.
3. **Extend the consolidated components from step 07.** No new per-screen variants.
4. **Hold the system:** tokens only (a new size or colour is a token change, not a class), screens
   class-free, a story for every new state, light and dark. A deviation "because it looked better
   this way" is a new decision: take it back to the user instead of making it here.
5. **Move each approved mock into its real home as its journey lands**, and delete `ui/src/mocks/`
   once the last journey is real.
6. **Run the checks as you go:** `bun run typecheck`, `bun test`, `make lint`, `make ui-build`.
   Don't accumulate a backlog of breakage for the end.

## Exit gate

- [ ] every approved journey is implemented and matches its approved mock
- [ ] the build and the tests pass
- [ ] the catalogue covers the new states, in light and dark

Then invoke `refactor-ux-10-icp-panel-look`.

## Why this matters

Eight steps went into converging on one direction. A build that quietly invents a new one throws
all of them away.
