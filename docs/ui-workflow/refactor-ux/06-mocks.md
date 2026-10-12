# 06 — Mocks, round 1

Status: **approved by the owner, 2026-08-29**, with three review notes applied (below).
Nothing here is wired to the platform, and the whole folder is deleted in step 09 once each
approved direction is real.

## What was built

Mocks are Storybook stories (the owner's decision), from the accepted panel changes in
[03-journeys.md](03-journeys.md) and the direction in [05-palette.md](05-palette.md). All of them
sit under the `Mocks/` group, so they cannot be mistaken for the real catalogue.

| Stories | What it argues for | Panel finding |
|---|---|---|
| `Mocks/Rail row — spend and last moved` | Spend and when-it-moved on the row's second line (2xs, mono, muted); a stopped run keeps its dot but loses the accent | J1, J6 — spend was hover-only; the 30-minute flag kept a dead run looking alive |
| `Mocks/Transcript — marks, Enter, tool card header` | The committed message keeps its steer/queued mark; Enter as two options (a hint, or a newline while a run is live); Show output moves into the card header; output stays open after a settle | J3, J4 — the mark died at commit; the control sat under the output; the card remounted collapsed |
| `Mocks/Settings — one commit moment` | The image field commits from its own button and shows applied/refused where it sits; no caption has to explain a blur exception | J5 — a saved value and a typed one looked the same |
| `Mocks/Workspaces — a running row` | The workspace row says whether anything is running in it (`running` is already mapped and never rendered) | J2 |
| `Mocks/Phone type — before and after` | The phone ladder, today against the proposal: 12 / 13 / 14 / 15 / 16, so `sm` and `base` stop colliding | J6, cross-cutting pain 4 |

Two of them are shown as choices rather than one answer, because the owner has to pick:
Enter's behaviour mid-run (`Option A: keep Enter as steer, and say so` / `Option B: Enter is a
newline while a run is live`).

## Honesty notes

- The mocks use tokens, the layout primitives, and the real components
  (`PaneFooter`, `Text`, `Button`, `Input`, `Badge`, `StatusDot`). Nothing invents a class.
- The phone-type mock sets `--text-*` locally on two wrappers so both ladders can stand side by
  side at any viewport. Tailwind emits `font-size: var(--text-sm)`, so the override is real, not a
  picture of one.
- The "last moved" formatter does not exist yet: the row mock takes the label as a prop, so the
  shape is judged, not the wording. Writing it is step 09 work.
- This sandbox has no browser. The mocks were checked by compiling them, not by looking at them:
  `bun run typecheck`, `bun run lint`, `bun run check:system`, `bun run format:check`, `bun test`
  (77 pass) and `bun run build:storybook` (completed). Looking at them is the owner's step.

## How to look

From the repo on the host: `cd ui && bun run storybook`, then open the **Mocks** group. The
built catalogue is also in `ui/storybook-static/` if the dev server is not wanted.

## Review round 1 (owner, 2026-08-29)

"It looks good", with three notes. All three are applied:

1. **Enter: Option A** — Enter keeps steering a live run, and the composer says so. Option B is
   kept in the file as the rejected alternative. The two stale docs that claim Enter is always a
   newline get corrected in step 09, with the hint line.
2. **The workspaces mock was too wide on a phone** — and the owner was right about the cause: the
   mock kept its desktop shape. The row did not wrap, so the running mark, the badge and the two
   buttons sat on one line that could not shrink. The mock now wraps (`flex-wrap`, controls on
   their own line below `sm`) and has a `Phone` story. The real screen has the same non-wrapping
   row (`workspaces-screen.tsx`), so step 09 owes it the same rule.
3. **Thinking cards get the tool card's treatment** — reasoning is the same kind of long text, so
   the control moves into the header and reasoning that was open stays open after it settles.
   Both are mocked (`Thinking Card Header`, `Thinking Card Stays Open`); the remount is the same
   bug (`live-thinking`, `app/map.ts:412`).

Checks after the change: `typecheck`, `lint`, `check:system`, `format:check`, `bun test` (77
pass), `bun run build:storybook` — all green.

## Review round 2 (owner, 2026-08-29)

"On tool call and thinking maybe collapse should show the first 2 lines." Applied as mocks, and
paired with the threshold, because the two are one decision:

- **Fold to two lines, not a window.** Today a folded tool card is a 200px window
  (`--tool-card-collapsed-height`) and a folded thinking card 120px (`--thinking-card-collapsed-height`)
  — 200px of mono is most of a short output, so nothing is really folded. The mocks
  (`Tool Card Peek`, `Thinking Card Peek`) show two lines with the count on the header control.
- **The threshold moves with it.** A fold past 10 lines or 2000 characters plus a two-line peek
  means a twelve-line output needs a click to be read. `Tool Card Short Output Stays Open` argues
  for folding past about twenty lines, so the peek only ever hides what was too long to read.
- Running and error cards keep their rule: they stay fully open, peek or not.

**Decided (owner, 2026-08-29):** two lines for both cards, and the fold threshold stays at 10
lines / 2000 characters. The trade-off is accepted knowingly: a twelve-line output folds to two
lines and needs a click, where a 200px window used to show most of it. The count on the control
is what keeps that honest.

If approved, the `2` becomes a component token in step 09 (the way the collapsed heights are
component tokens today); `line-clamp-2` in the mock is the shape, not the implementation.

## Waiting on

- The owner's notes are in; step 06 is closed for the direction the mocks show, with round 2 open
  on the folded height (two lines) and the fold threshold (about twenty lines).
- Then step 07: consolidate, starting from `ui/src/components`.
