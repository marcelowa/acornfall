# 02 — Confirm the goal (run 2)

Status: **accepted by the owner, 2026-10-12** — the phone clause was written from their step 01
answers and they answered the only open question (the workspaces layer loses its URL) without a
correction. Run 1's goal (2026-08-29) stands; run 2 adds one surface, so the statement below is
run 1's goal plus the phone clause, which was the part open to correction.

## The goal statement, as a claim

Acornfall is a local-first agent console for one technical operator. A Go gateway supervises a bun
worker and a microVM sandbox per workspace, and `ui/` is the only face of it. Run 1's working-well
list stands unchanged: find the right conversation in a rail of dozens, read a tool-heavy turn
without losing the place, intervene mid-run with no doubt about the control, change a setting once
and know it stuck, and see what the model saw and what it cost.

Run 2 says the phone is a real surface, not a shrunken desktop. Working well on a phone means:

- the owner can write and send with one thumb while the keyboard is up, and the composer is never
  the thing the keyboard covers;
- the composer at rest is folded — it says what it is, takes one tap to open, and never pops the
  keyboard on its own;
- one gesture takes it back down: swipe down from the composer's top border, and the field
  unfocuses and folds;
- the navigation has one shape: the conversation rail and the workspaces list both open from a
  button, both slide in from the left, both close with an X, and neither is a destination with a
  URL of its own;
- nothing the owner must hit with a thumb is under 44px on a phone, and the icons in the bar, the
  drawer and the rail head are legible at arm's length;
- desktop is untouched except where a shared component must step up below `sm`, and the direction
  in `design.md` still holds on both widths.

Success on a phone: the owner checks a run and sends a follow-up from the couch, with the phone in
one hand, and does not put the phone down to walk to the laptop. Failure on a phone: the keyboard
covers the composer, or the drawer arrives from a direction they did not expect, and the phone
becomes a read-only window again.

The measurement stays the same as run 1: does the owner still reach for the console, now including
from the phone, and how long does it take to resume the right conversation.

## The foundation clause

One operator today. The interface must later carry a multi-user platform without a rewrite, so
this pass owes foundation — tokens, journeys, a written direction, components that take props — and
not multi-user features or invented personas. Run 2 adds one line to it: a phone behaviour belongs
in a component or a token, not in a screen, so the next surface (tablet, second client) inherits
it.

## What "working well" does not mean in run 2

- Not new capabilities, and not a new client: the pass runs against what already works.
- Not a desktop restyle. Desktop changes only where a shared component must move, and then it
  keeps run 1's ladder.
- Not new hues. The palette is closed; the only ladder under review is the phone step.
- Not a PWA, offline mode, or push: nothing about installing the console on a home screen.
- Not a rewrite of the workspaces screen's content — it keeps its rows, its menu and its sandbox
  dialog; what changes is how it is opened and closed.

## The owner's answers carried in from step 01

Confirmed in the message that closed step 01: left-slide drawer with an X; workspaces as a layer,
not a page or a URL; the folded composer and the drag handle mocked before deciding; sizes tried
phone-first as proposed. See `01-frame.md`.

## Confirmation

Owner, 2026-10-12: "lose the url" — the workspaces layer keeps no URL, the X is the way out. No
correction to the phone clause was given, and the pass moved to step 03 on that reading.
