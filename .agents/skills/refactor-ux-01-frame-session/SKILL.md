---
name: refactor-ux-01-frame-session
description: Open a dedicated session for a UI/UX pass on acornfall's console (ui/), journeys and ICP checks first, pixels later. Step 1 of the acornfall refactor-ux chain. Use when asked to improve the UI, redesign the console, or start a UI/UX pass.
---

# Frame the refactor session

Entry point of the chain. Steps 02–12 sit beside this file in `.agents/skills/`, reached by name,
one at a time, each behind its own gate.

## When to use it

Start of a UI/UX pass on acornfall's console (`ui/`). Not for a new feature: these passes run
against capabilities that already work.

## The frame

The console is not a fast-built throwaway. It has a token system with teeth (ADR-0016), a
Storybook catalogue, and a finished milestone pass (`docs/ui-workflow/milestones.md`, M1–M6 and
R2–R6). So this session is not "make it look nicer": it is a second, gated pass that starts from
journeys and persona checks and only then touches pixels. The operator today is one person, the
owner; multi-user support is a later platform decision, and this pass owes it a foundation, not
features.

## The playbook

1. **Track the chain first.** Create one todo per step — frame session, confirm goal, draft
   journeys, panel on journeys, palette, mocks, consolidate, doctor, build, panel on the look,
   final pass, finalize docs — and mark this one in progress. Later steps update the same list.
2. **State the frame above back to the user in your own words and get a real confirmation** before
   reading code or asking about the goal.
3. **Open the run's notes folder**: `docs/ui-workflow/refactor-ux/` in the repo, one file per step
   as it lands, starting with `01-frame.md`. `design.md` and `icp.md` stay at the repo root.
4. **Know where these skills live.** They are in the workspace
   (`<workspace>/.agents/skills/refactor-ux-*`) while the chain is young; step 12 mirrors them into
   `acornfall/.agents/skills/`.

## Exit gate

- [ ] the 12-step todo list exists
- [ ] the frame was stated back and the user confirmed it

Then invoke `refactor-ux-02-confirm-goal`.

## Why this matters

A pass that starts in the code inherits the assumptions of the last one. Naming the frame and
keeping the whole chain visible is what stops twelve steps collapsing into "restyle it".
