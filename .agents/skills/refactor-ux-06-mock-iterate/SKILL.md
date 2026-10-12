---
name: refactor-ux-06-mock-iterate
description: Turn the journeys and palette into Storybook mocks and iterate with the user until the direction is explicitly approved. A gate. Step 6 of the refactor-ux chain.
---

# Mock the journeys, then iterate

## When to use it

Right after step 05, same session, never standalone.

## The playbook

1. **Mocks are Storybook stories here** (the owner's decision, and ADR-0016's design surface). Put
   prototypes under `ui/src/mocks/` with `Mocks/…` titles — beside the real catalogue, clearly not
   it. The user reviews them with `bun run storybook` on their host; this sandbox has no browser,
   so keep `bun run build:storybook` passing too.
2. **Mock the key steps of each journey from step 03**, in the palette from step 05, in light and
   dark, with real content: a long tool-heavy turn, a rail of dozens, a live run, a phone width.
   One generic hero screen proves nothing.
3. **Stay honest to what step 09 can build.** Tokens, the layout primitives, and data the gateway
   really produces. A mock that needs invented state sets up a mismatch later.
4. **Iterate round by round.** Show, take specific reactions, revise. Several fast rounds beat one
   slow one.
5. **Stop only on explicit approval of the direction**, never because changes ran out.
6. **Log each round to `docs/ui-workflow/refactor-ux/06-mocks.md`** — what was shown, what
   changed, what the user said.

## Exit gate

- [ ] mocks exist for the key steps of the drafted journeys, light and dark
- [ ] the user has explicitly approved the mocked direction

Then invoke `refactor-ux-07-consolidate`.

## Why this matters

Mocks are the cheapest place to be wrong. With an approved mock, step 09 executes a decided
direction instead of arguing one out in code.
