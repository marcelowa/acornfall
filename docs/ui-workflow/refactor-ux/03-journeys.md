# 03 — The desired journeys

Status: **reviewed and approved by the owner, 2026-08-29**, with the persona set in `icp.md`.
Now under panel review in step 04. One journey per real pain named in
[01-frame.md](01-frame.md). Written as sequences, not features. `fights today` is marked after the
panel in step 04 looks at the current console; nothing below claims to know that yet.

## J1 — Resume the right conversation

- Entry: the console is open on a rail holding dozens of conversations.
- Steps: scan the groups → recognise the one you want (title, running dot, cost) → open it → land
  at the end, following live if it is running.
- Success moment: the right conversation is open, without opening a wrong one first.
- Pains answered: the rail (pains 1).
- Today: exists (M2, R2). Owner reports friction.

## J2 — Pick up another workspace

- Entry: the owner has more than one workspace; the active one is not the one they want.
- Steps: switch workspace from the rail → see that workspace's conversations → open the latest →
  see what its worker is doing.
- Success moment: context restored in one move, and the switch reads as a switch, not a reload.
- Pains answered: the rail (pains 1).

## J3 — Read a long, tool-heavy turn without losing the place

- Entry: a run is streaming tool calls into the transcript.
- Steps: follow the answer → open a tool card for evidence → close it → keep reading → jump to the
  latest when scrolled away.
- Success moment: evidence can be skipped and revisited without re-reading the turn.
- Pains answered: the general surface — type sizes, spacing (pains 4).
- Today: exists (M3, R5, R6). Suspected `keep as is` plus surface polish.

## J4 — Intervene in a live run, with no doubt about which button does what

- Entry: a run is live and the owner wants to change its course.
- Steps: type while it runs → the composer offers one choice at a time (steer now, or queue after)
  → send → the transcript records which one happened.
- Success moment: no question afterwards about whether the model got the message now or later.
- Pains answered: the composer (pains 3).
- Today: exists (M4, R4, R5).

## J5 — Change a setting once and know it stuck

- Entry: one preference feels wrong (model, thinking, agent, theme, sandbox).
- Steps: open settings → change it → watch it apply, or get a clear save → return to the
  transcript.
- Success moment: the setting is in effect, with one save model and no second guess.
- Pains answered: the settings screen, phone and desktop (pains 2).
- Today: exists (M6). Owner reports friction.

## J6 — Check on a run from a phone

- Entry: the owner is away from the desk, phone in hand.
- Steps: open the console → open the rail as a drawer → pick the conversation → read the last turn
  → optionally send a follow-up.
- Success moment: "is it done?" is answered in under a minute, then closed.
- Pains answered: the rail and the general surface on a phone (pains 1 and 4).
- Today: exists (R2, R3, M4 two-row footer). Owner reports friction.

## Not journeys: the cross-cutting surface rules

Pains 4 is a set of rules that applies to all six journeys, not a path through the product. It goes
to step 05 (palette) and step 07 (consolidation) as constraints:

- one type scale, honest at both widths — no shrunken desktop on a phone;
- one icon size ladder, one button size ladder;
- named spacing steps, used the same way in every panel;
- motion only where it answers an action; reduced motion respected.

## Accepted changes (step 04 gate, 2026-08-29 — "agree to all")

**J1.** The row shows spend and when the conversation last moved, without a hover; when a run's
last update falls outside the freshness window the dot stops claiming life. Where the values sit
is decided in the step 06 mocks.

**J2 — rewritten to what the UI owns.** The switch is rail → Workspaces → Open (the rail head
holds an icon, not a switcher). The Workspaces screen marks a running row — `running` is already
mapped (`app/view-models.ts:17`) and never rendered. The rail list and its title stay honest
during a switch instead of showing the old workspace under the old title. Landing on the latest
conversation is **dropped from this pass**: it is a gateway decision
(`control.go:2582` `defaultConversation` prefers the root), recorded as a follow-up rather than
carried as a UI change. Correct this reading if the Go change was meant to be in scope.

**J3.** Show output / Show less moves into the card header (`components/transcript/tool-card.tsx:96`
is in the footer, under the output). Output that was open while a call ran stays open after it
settles (today the entry id changes, so the card remounts). **The thinking card gets the same two
changes** (owner's review note, 2026-08-29): reasoning is the same kind of long text, so its
control moves into the header too, and reasoning that was open stays open when it settles — the
live entry is keyed `live-thinking` (`app/map.ts:412`) and remounts the same way.

**J4 — wording rewritten.** Three labelled choices, one meaning each, are the shipped and
approved shape. Added: the committed message keeps its steer/queued mark, which today lives on
the pending card only (`app/map.ts:447`; the committed entry, `map.ts:305`, has no field for it).
**Enter: Option A** (owner's decision, 2026-08-29) — Enter keeps steering a live run, and the
composer says so; Shift+Enter stays a newline. The two stale doc claims (`milestones.md` M4,
`docs/ui-workflow/06-interaction-report.md`) are corrected with it.

**J2** also carries a width rule from the review: the workspace row wraps below `sm`, so the
controls drop to their own line instead of the row running off a phone.

**J5.** One commit moment per settings page: the sandbox image drops its blur exception, and a
refused commit reads as refused where the field sits, instead of a strip at the top while the
typed text stays looking applied.

**J6.** The phone check-in answers done / cost / last-moved without a hover, and the phone type
ladder stops colliding (step 05).

**Still to verify during step 09** (panel claims I could not confirm by reading): the rail keeping
the old list and title during a switch, "the inspector shows only the latest request", "no Escape
handler in settings", and the image field's exact commit path.

## What the panel gets

Each journey above, plus the current console for contrast, plus the persona blocks from `icp.md`
(OWNER-OPERATOR, DELEGATOR, TINKERER). The panel's job is to attack these journeys, not to add
features: the pass runs against capabilities that already exist.
