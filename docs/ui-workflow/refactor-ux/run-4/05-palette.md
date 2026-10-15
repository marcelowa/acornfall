# 05 — The release surface's direction (run 4)

Status: **proposed to the owner, 2026-10-15.** Run 1's palette, type ladder and rules stand
(`design.md`): this surface adds no hue, no ramp and no new token. What it settles is the page's
order, the states it must carry, its wording, and which steps of the existing ladders it uses. A
surface direction, like run 2's phone ladder and run 3's long values.

## The claim

The owner asks one question from the bar — "am I current?" — and four on the page: what runs, what
is offered, what changed, and what pressing does. So the page reads **running → offered → changed →
cost and risk → the press**, top to bottom, and the press is last on purpose: reading is free, and
installing is deliberate (R10). Everything the surface decides follows from those two sentences.

## The bar's mark

- One control at both widths, R12. A desktop shows the arrow with the newest GA's tag beside it; a
  phone shows the arrow alone, and its accessible name carries the target ("Update available:
  v0.9.33") — a bare mark cannot say a version, but it can say one to a screen reader.
- The tag is a fact: mono, `2xs`, muted. The mark is the only accent, and it is the same `primary`
  the console uses for "the thing to press".
- Restart pending takes the same spot with its own mark and label, in `warning`. It is the one state
  that needs the owner and cannot wait for a page visit.

## The page, top to bottom

| Where | What it says | Ladder |
|---|---|---|
| Head | the running build, and the page's title | `xl` title, `2xs` running line |
| The release card | target tag, its date, its notes, the size, the backup note, the keep/clean choice, **Install** | `sm` title, notes `base` (they are writing, not a fact), facts `2xs` mono |
| The picker | the last twenty, a row per release | rows `sm`, tag mono, facts `2xs` muted |
| Recovery | rolled back: cause, tag, **Roll back**, **Check now** | `xs` prose, `2xs` facts |

- **The notes print at `base`.** They are the release's own words, and the one piece of real prose on
  the page; everything else is a fact and stays quiet (`2xs` muted, mono for values) per run 1.
- **Every tag is mono.** A version is a value, and values are comparable down a column — the picker
  only works if the tags line up.

## The picker row

One row per release, a link to its version page, never a row with two actions (picking is not
installing):

- line 1: the tag (mono, `sm`) and two marks when they apply — **running**, and **pre** for a
  non-production build;
- line 2: date · size · production or pre-release, `2xs` muted.

Production readiness is a **fact, not an alarm**: the pre-release mark is muted mono (`-rc`), not a
coloured badge, because an rc is a choice someone makes on purpose, not a failure. The running mark
is the console's existing running state (`secondary`), not a new colour.

## The states the page must carry

Each one is a sentence, never a bare spinner (R11):

| State | The page says |
|---|---|
| Checking | that a check is in flight, and it leaves the last answer on screen |
| Up to date | that the running build is the newest GA, with the date it checked |
| Newer available | the target, its size, and the running build beside it |
| Restart pending | that the files are swapped, the old process answers, and **Restart** finishes it |
| Restarting | that the new build is taking over, and that the page will say when it answers |
| Lost the gateway | that it cannot reach the gateway any more, with **Check again** — no give-up timer |
| Rolled back | the cause, the tag that failed, **Roll back**, **Check again** |
| Refused source | which refusal it is — no token, no network, empty list — in the gateway's words |
| `dev` build | "dev build — not a release tag", with no newer or older claims |

## Wording

Sentence case, active voice, the interface's own voice (`design.md`, Writing). One action, one name
(R12): **Install** is the verb, everywhere the action appears; the bar's control is the **update
mark**. **Not now** replaces "Wait for drain" because it names what the press does. **Stop runs and
install** says what it stops. **Check now**, **Roll back**, **Restart**, **Releases** complete the
surface's vocabulary. A refusal is the gateway's sentence where the gateway has one.

## What this direction does not do

- No new hue, ramp, or token: every tone here already exists, and a state that needs one takes an
  existing one.
- No count badges (the `1` goes), no second verb, no coloured pre-release.
- No motion: the restart is a state change, not an animation; reduced motion changes nothing
  because nothing moves.
- No spinner-only state, and no timer that decides what the page claims (R11).

## Confirmation

_(to be filled when the owner confirms)_
