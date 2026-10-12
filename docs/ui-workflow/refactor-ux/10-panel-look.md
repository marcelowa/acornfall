# 10 — Panel on the look

Date: 2026-08-29. The same three personas from `icp.md`, judging the shipped look from the source,
the built catalogue's story list and `09-build.md` — no browser in the sandbox, which each one
said in its own words. This is the record of what they found and what was done about it. The
feedback itself arrived raw in the session; the summaries below are the decisions, not a rewrite.

## Round 1

**OWNER-OPERATOR — approve with changes.** Keep: the row's second line, the phone ladder, the
stale rule, the fold in the header with the count on it, the fold surviving the settle, result
words rather than colour alone, the light/dark body pairs. Cut: the thinking card folding at
settle; the Enter line, false when `steerable` is false and on touch; `primary`/`destructive` as
small text. Confused by: nothing ticks, so the stale rule and the ages do not age; the draft
printing smaller than the sent text; a long tool name with nothing to shrink; no phone stories for
the two screens; the steer mark sitting with the controls.

**TINKERER — approve with changes.** Keep: the header fold on both cards, two lines instead of a
window, the ladder, the Enter line's placement, the outcome under the field. Cut: the image field's
outcome being owned by nothing (any refusal printed as this field's; "Applied" died in the reload
that confirmed it); the doubled line count on the thinking card; "Show output" counting the
arguments. Confused by: one fold that survives and one that does not; the fold button as a 24px
target on a phone; "Show output" showing the `$` args first; the draft's size.

**DELEGATOR — approve with changes.** Keep: the second line, the stale dot keeping its slot,
`formatMoved`'s shape, the ladder, the header fold, the row wrap, the menu visible on touch. Cut:
the word "running" on the workspace row, and the fourth decimal on the rail's cost. Confused by:
"compare down a column" not being what ships (one joined string, times at different x, the time
first to truncate); the stale rule living in one file while the top bar reads the raw flag; rows
that grow when they learn their first token; the row stories rendering at 320px when the rail
ships at 280 and drags to 192.

## What changed because of it

- **Enter does what the buttons offer** — steer when the worker can, queue when it cannot — and the
  line says which. It shows nothing on a coarse pointer, where Enter is a newline.
- **The draft is `text-lg`**: it was inheriting the primitive's `md:text-sm`, so the smallest print
  in the console was the text being typed against 16px answers.
- **Small status text uses the subtle-foreground tokens** (the tool status word, the refused line,
  the applied line): `primary` and `destructive` sit under the small-text floor in dark.
- **The image field owns its own outcome**: derived from the value it sent, so any refusal
  elsewhere cannot print as this field's, and "Applied" survives the reload that confirms it. The
  three states are `UI/SettingsOutcome`, storied, so a page cannot invent a fourth.
- **The stale rule is one rule** (`lib/clock.ts`, `runState`) with one tick (`useNow`, a minute),
  read by the rail row and the top bar, and `StatusDot` gained a `stale` state so the label stops
  saying "Running" for a run nobody has heard from.
- **The row's line is always there**, spend left and age right: rows stop growing when they learn
  their first token, ages line up, and the time is the last thing a narrow rail takes away.
- **Smaller ones:** the thinking card's count is on the button, not twice; the tool control says
  "Show all (N lines)" because that is what it shows; a long MCP name truncates; the steer mark sits
  beside the time; the fold button is thumb-sized on a coarse pointer; the row stories render at the
  rail's real width, with a narrow case; the two screens have phone stories.
- **The thinking card's fold survives the settle** by being keyed on the beginning of its own text,
  which is the only thing that survives — the wire gives a message no id.

## The one thing taken back out

**The workspace row's running mark is gone.** DELEGATOR checked the field: the wire's per-workspace
`running` is `Control.WorkerUp()` (`control.go:878`) — the workspace's *worker process* being up,
not a turn in flight. A warm, idle workspace therefore showed a lit dot and the word "running",
which is worse than no mark: it answers the wrong question confidently. The mark was built on the
step 04 reading of that field and the panel was right to catch it. A per-workspace run flag needs
the wire to carry one; when it does, the mark comes back. The row wrap stays.

**Declined, with the reason:** dropping the fourth decimal from the rail's cost. Most turns cost
fractions of a cent — at three decimals a `$0.0031` turn prints as `$0.003`, and at two it is
`$0.00` for every cheap conversation, which is the comparability the row exists for.

## What each persona approved

- Step 04, journeys: all three approved the six journeys with the changes recorded in
  `03-journeys.md`.
- Step 10, look: round 2 re-run after the changes above — recorded at the end of this file when it
  lands.
