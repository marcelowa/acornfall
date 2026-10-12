# ICP — who this console is for

Status: approved by the owner, 2026-08-29. Read by every panel in the `refactor-ux` chain
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

- Step 04, journeys: pending this run.
- Step 10, look: pending this run.
