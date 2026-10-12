# The refactor-ux chain

Twelve gated steps for a UI/UX pass on a product that already works. Adapted from the `refactor-ux`
chain published with [godharness](https://github.com/tomerwave/godharness) to this repository: the
tokens-or-nothing system (ADR-0016), Storybook as the design surface, `check:system` as the health
check, and `design.md` / `icp.md` at the repo root as the output.

The skills live in `.agents/skills/refactor-ux-01..12`, so every harness that reads that folder
(Claude Code, Codex, acornfall's worker) can run them. Step 1 is the entry point; each later step
is reached by finishing the previous step's exit gate.

| # | Step | Gate |
|---|---|---|
| 01 | Frame the session | the frame is stated back and confirmed |
| 02 | Confirm the goal | the goal matches the owner's words |
| 03 | Draft the journeys | they are sequences, and the owner reviewed them |
| 04 | Panel on the journeys | **gate** — every persona gave un-softened feedback, and the owner reacted |
| 05 | Pick the colour scheme | the palette is named, justified, and confirmed |
| 06 | Mock and iterate | **gate** — the owner approved the mocked direction |
| 07 | Consolidate | one implementation per pattern; checks green |
| 08 | Framework doctor | the health checks ran; what they flagged is fixed or logged |
| 09 | Build for real | every journey matches its mock; build and tests pass |
| 10 | Panel on the look | **gate** — every persona approves the shipped look |
| 11 | The owner's final pass | their notes are applied or declined with a reason |
| 12 | Finalize the docs | `design.md` and `icp.md` reflect what shipped |

## Run 1 — 2026-08-29, branch `docs-ui-refactor-chain`

The record, one file per step, is in this folder:

- `01-frame.md` — the frame, the 12-step list, the owner's named pains.
- `02-goal.md` — what the console is for.
- `03-journeys.md` — the six journeys and every change they took.
- `04-panel-journeys.md` — the first panel, raw, with the code behind each finding.
- `05-palette.md` — the direction: colour roles, the phone type ladder, size ladders, motion.
- `06-mocks.md` — what was mocked, in which Storybook group, and the rounds.
- `07-consolidation.md` — what merged, what stayed, and why.
- `08-doctor.md` — the health checks, the one story gap found, and the a11y limits.
- `09-build.md` — what shipped, journey by journey, and the one place it could not match.
- `10-panel-look.md` — the second panel, and the round-2 check.
- `11-final-pass.md` — the owner's notes: two phone defects, the tooltip, and two IA moves.

The output is `design.md` and `icp.md` at the repo root.

## Run 2 — 2026-10-12, branch `refactor-ux-2-mobile`, the phone pass

Over the composer and the keyboard, the top bar and its sizes, and the two layers (the rail and the
workspaces list). Same twelve steps, in `run-2/`:

- `01-frame.md` — the frame, the todo list, the owner's five named pains, and their answers.
- `02-goal.md` — run 1's goal plus the phone clause.
- `03-journeys.md` — J7–J10 and the rules; J11 folded into J7/J9 as a regression line.
- `04-panel-journeys.md` — the panel, raw, and the seven calls the owner took from it.
- `05-palette.md` — the phone ladder: the 44px reach below `sm`, 20px chrome icons, 16px fields,
  one left slide, one keyboard variable, the folded composer.
- `06-mocks.md` — the ten phone mocks, the live catalogue URL, and the row-per-journey table.
- `07-consolidation.md` — one `Layer` (`ui/sheet.tsx` deleted), one close, one `--bar-height`, the
  phone step in the ladders, `WorkspaceRow` extracted.
- `08-doctor.md` — the checks, the probe the phone step gained, and the a11y limits.
- `09-build.md` — what shipped, journey by journey, and the mocks deleted.
- `10-panel-look.md` — the second panel's findings and the fixes they forced.
- `11-final-pass.md` — the owner's five notes on the live build, including the one that superseded
  the drag band this run had mocked and built.

**Where a step supersedes an earlier one:** step 11 cut the drag band that steps 05, 06 and 09
speak of, and the composer's folded pill with it. Those files are the record of what was decided
then, not a description of the shipped build; `design.md`'s phone section is the shipped direction.

## Running it again

Read `refactor-ux-01-frame-session` and follow the chain. The gates need the owner's reaction; the
steps that need nobody are 07, 08 and 09. Say which step you are on in the run's notes, so an
interrupted session resumes where it stopped rather than starting over.
