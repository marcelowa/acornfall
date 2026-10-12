# 01 — Frame the session

Date: 2026-08-29 (chain run 1, branch `docs-ui-refactor-chain`)

## The frame, as stated back to the owner

Acornfall's console is not a fast-built throwaway. It has a token system with teeth (ADR-0016),
a Storybook catalogue, and a finished milestone pass (`docs/ui-workflow/milestones.md`, M1–M6 and
R2–R6). So this is not a "make it look nicer" pass: it is a second, gated one that starts from the
owner's journeys and persona checks and only then touches pixels.

The operator today is one person. Multi-user is a later platform decision; this pass owes it a
foundation (tokens, journeys, a written direction), not features.

Confirmed by the owner in the same message that answered the setup questions.

## The 12-step todo list

- [x] 01 Frame the session
- [x] 02 Confirm the goal
- [x] 03 Draft the desired journeys
- [x] 04 Panel on the journeys — gate passed, all changes accepted
- [x] 05 Pick the colour scheme — confirmed (roles, phone ladder, size ladders, motion)
- [x] 06 Mock and iterate — approved with three notes, all applied
- [x] 07 Consolidate — transcript cards onto `PaneCard`, settings onto `SettingsGroup`/`SettingsField`
- [x] 08 Framework doctor — checks green; `user-message` storied; no browser for the a11y run
- [x] 09 Build for real — all eight changes in the app, mocks deleted, 18 commits on `docs-ui-refactor-chain`
- [x] 10 Panel on the look — round 1 with changes, all applied; round 2 checked in-session (child limit)
- [x] 11 The owner's final pass — two phone defects, the clipped-name tooltip, two IA moves
- [x] 12 Finalize the docs — `design.md`, `icp.md`, the chain mirrored into `.agents/skills/`

Run 1 closed 2026-08-29. Next time: start at `refactor-ux-01-frame-session`, and read `README.md`
in this folder first.

## The owner's named pains (input to step 03)

1. The rail: conversations, workspaces, icons, text sizes, phone against desktop.
2. The settings screen: phone and desktop.
3. The composer.
4. The general surface: text sizes, icon and button sizes, spacing, animation, phone and desktop.

## Decisions taken while framing

- Mocks are Storybook stories, not standalone HTML (owner's choice; ADR-0016's design surface).
- The chain lives in the workspace first (`.agents/skills/refactor-ux-01..12`), mirrored into the
  repo at step 12.
- The workspace skill `frontend-design` moved out of the skill path to
  `.attachments/frontend-design/`: the direction for this pass comes from steps 05–06, and a
  second, generic design voice beside them is a conflict, not a help.
- Run notes: this folder. Direction docs at step 12: `design.md`, `icp.md` at the repo root.
- This sandbox has no browser: `make ui` cannot run here. Step 6 mocks are reviewed by the owner
  with `bun run storybook` on their host.
