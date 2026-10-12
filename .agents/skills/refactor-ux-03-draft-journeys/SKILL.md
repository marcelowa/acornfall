---
name: refactor-ux-03-draft-journeys
description: Draft the console journeys acornfall should have — from the owner's real pains — before any pixels. Step 3 of the refactor-ux chain.
---

# Draft the desired journeys

## When to use it

Right after step 02, same session, never standalone.

## The playbook

1. **Start from the owner's named pains, not a feature list.** The 2026-08 run named four areas:
   the rail (conversations, workspaces, icons, text sizes, phone against desktop), the settings
   screen, the composer, and the general surface (type sizes, icon and button sizes, spacing,
   motion, both widths). Chase those first; add what the code says is missing.
2. **Name each journey as a sequence a specific person takes to a specific outcome** — entry
   point, the steps between, the moment it succeeds. "Resume a conversation", not "rail".
3. **Propose before taking dictation.** Say which journeys you would design for this owner and
   why, then let the user react.
4. **Flag the journeys the console fights today.** Those are the refactor's real targets — more
   than any single screen's polish.
5. **Write them to `docs/ui-workflow/refactor-ux/03-journeys.md`**, each marked `new`, `fights
   today`, or `keep as is`.
6. **No mockups, no palette, no code.** Step 04 pressure-tests the journeys first.

## Exit gate

- [ ] the journeys are written as sequences with an entry and a success moment
- [ ] each one names the pain it answers
- [ ] the user has reviewed them and they match what they want

Then invoke `refactor-ux-04-icp-panel-journeys`.

## Why this matters

"Improve the UI" with no named journeys becomes new colours on the same broken paths. The journeys
give the rest of the chain something concrete to redesign toward.
