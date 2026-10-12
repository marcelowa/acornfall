# ICP — who this console is for

Status: approved by the owner, 2026-08-29; carried into run 2 (2026-10-12) unchanged. Read by every
panel in the `refactor-ux` chain
(`.agents/skills/refactor-ux-04-icp-panel-journeys`, `-10-icp-panel-look`), so the reviewers stay
the same people across passes.

## The set, and why it looks like this

Acornfall is one operator today: the owner, running it for themselves. So the honest set is one
real person in three modes, taken from `docs/ui-workflow/02-need-report.md`. The modes are not
invented buyers — they are hats the same person wears, and they are the only reviewers whose
reaction is evidence.

Personas are reused verbatim across passes. A fresh persona each round leaves nothing to compare
against.

## Feedback format (every panel, both passes)

One line each, in this order:

- **keep** — what already works and must survive the change;
- **cut** — what costs more than it gives;
- **confused-by** — where the interface leaves the reviewer guessing;
- **would I keep using this** — the churn verdict, honest, no softening.

A reviewer that cannot see something says so instead of guessing.

## Why no multi-user persona is in here

A teammate, a buyer, or a hosted tenant does not exist yet. Judged against one, a panel returns
false confidence: invented approval, for a platform nobody has asked for. The later multi-user
platform is protected by the foundation clause in `docs/ui-workflow/refactor-ux/02-goal.md`
(tokens, journeys, written direction, components that take props) — not by a stand-in persona. When
the first real second user exists, their block goes in this file and the panels change.

## Personas

### Persona: OWNER-OPERATOR

- role: the person who runs acornfall for themselves; buyer, user and admin in one. Lives in the
  transcript, keeps several conversations per workspace.
- goal: keep a full working session readable and steerable from open to close; always know what
  ran, what it cost, and where it ran.
- triggers churn: losing the place in a long turn; opening the wrong conversation to find the
  right one; a control whose effect is ambiguous; an interruption that costs more than the task.
- judges "good" by: whether they still reach for the console instead of a terminal, and how long it
  takes to resume the right conversation.
- reviews: journeys, look
- feedback format: keep / cut / confused-by / would I keep using this — one line each

### Persona: DELEGATOR

- role: the same person, running several conversations and subagents at once, checking on them
  rather than sitting inside one.
- goal: see which runs are alive, what each is doing, and catch a stuck one early; open a
  conversation an agent created and pick up its thread cold.
- triggers churn: a run that looks alive but is not; a busy signal that lies; a rail that cannot be
  scanned in a couple of seconds.
- judges "good" by: how little a check-in costs, and whether anything runs unnoticed.
- reviews: journeys, look
- feedback format: keep / cut / confused-by / would I keep using this — one line each

### Persona: TINKERER

- role: the same person, tuning defaults — model, thinking, agent, theme, sandbox — and reading the
  inspector to understand a surprising answer.
- goal: answer "why did the model see that?" without leaving the transcript, and change a default
  once with confidence.
- triggers churn: having to run the product to understand a state; two save models in one screen;
  settings that need a hunt to find.
- judges "good" by: whether the reason for a surprise is one move away, and whether a change sticks
  the first time.
- reviews: journeys, look
- feedback format: keep / cut / confused-by / would I keep using this — one line each

## What each persona approved

### Run 1 (2026-08-29)

- **Step 04, journeys:** all three approved the six journeys, with the changes recorded in
  `docs/ui-workflow/refactor-ux/03-journeys.md` — spend and the age on the rail row, the mark
  surviving a commit, one commit moment in settings, the phone type step, and J2 rewritten to what
  the UI owns.
- **Step 10, look:** round 1 was `approve with changes` from all three, and every item is listed
  with where it stands in `10-panel-look.md`. Round 2 could not run as a panel (the session was at
  its child limit and stopping a child did not free one), so it was checked item by item in that
  session and written down as weaker than the reviewers. The panel's sharpest catch was a lie:
  a workspace's `running` is its worker process (`Control.WorkerUp`), not a turn, so the run mark
  built on it was taken back out.
- **Step 11, the owner's pass:** two phone defects (the settings tab row, and a long tool name
  widening the page), the clipped-name tooltip, and the two information-architecture decisions —
  the sandbox fields moved behind a workspaces row's menu, and Appearance folded into Defaults.

### Run 2 (2026-10-12), the phone pass

- **Step 04, journeys:** the same three approved the four new journeys and folded the fifth (the
  phone check-in) into the send and the move-between-conversations paths, as a regression line
  rather than a journey of its own (`run-2/04-panel-journeys.md`). Their calls: one close, top-left;
  the band mocked before deciding; the workspaces list as a layer with no X of its own; Back closes
  the layer; the wide 44px reach, taken below `sm` only; and the rule that the fold never hides run
  state.
- **Step 10, look:** round 2 found three things that were not shipped as promised, and all three
  are fixed in `run-2/10-panel-look.md`: the layer had no close on the phone (the bar's toggle knew
  only about the rail), Back moved the address under the screen, and a stale run kept offering Stop
  in the composer. Two reviewers also wanted the drag band cut; the owner agreed at the next step.
- **Step 11, the owner's pass:** five notes, all answered in `run-2/11-final-pass.md` — the band
  cut (it cost 52px of a phone screen while typing), the keyboard for every focused field rather
  than the composer alone, the 44px ladder kept as one rule with no exceptions, the layer's focus
  behaviour fixed rather than made modal, and the desktop panel (option B) chosen after asking
  what the layer does on a wide screen.

## The direction this ICP approved

The shipped direction is written down in `design.md`: bronze on warm bark with blue as the second
voice, facts quiet in mono `2xs`, a two-line fold from the card header, an even phone type ladder,
and one commit moment per settings page. Run 2 added the phone's own section to it: one layer with
one close, a folded composer, one keyboard variable, a 44px thumb ladder below `sm`, and the
workspaces list as a layer with no address.
