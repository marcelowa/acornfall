# 02 — Confirm the goal (run 3)

Status: **proposed to the owner, 2026-10-13** — awaiting their correction. Run 1's goal
(2026-08-29) and run 2's phone clause (2026-10-12) stand; run 3 adds one surface, so the statement
below is those two plus the providers clause, which is the part open to correction.

## The goal statement, as a claim

Acornfall is a local-first agent console for one technical operator. A Go gateway supervises a bun
worker and a microVM sandbox per workspace, and `ui/` is the only face of it. Working well, from
run 1: find the right conversation in a rail of dozens, read a tool-heavy turn without losing the
place, intervene mid-run with no doubt about the control, change a setting once and know it stuck,
and see what the model saw and what it cost. Working well on a phone, from run 2: one thumb, the
keyboard never covering the composer, one shape for the navigation, and nothing under 44px.

Run 3 says settings → Providers is a surface the owner actually lives in, not a form they visit
once. Working well there means:

- the state of every provider is readable down the list — connected or not, how it is connected,
  and how many models it brought — and a row's action says what pressing it does;
- connecting is a guided path, not a form: pick a method, answer what the provider asks — a key, a
  choice, an address to open, a code to paste — and at every moment the dialog says what it is
  waiting for, in the provider's own words where it has them;
- **nothing long breaks the layout**: an authorization URL, a device code, a key, a provider name,
  a source path — anything long clips inside its own line, on a phone and on a desktop; no
  control may make the page or the dialog scroll sideways;
- copying is one gesture wherever copying is the point — an address to carry to another device, a
  code to enter, a key to paste — because on a phone the copy is how the flow leaves the console;
- the flow survives the person's mistakes: a stray tap does not end a sign-in, a prompt that the
  provider resolved itself goes away, and a refusal says what happened and offers the next step;
- finishing is visible and honest: the row updates with how it is connected and what it brought,
  and nothing claims a state it is not in.

Success: the owner connects a provider — a key or a sign-in — from the desk **or** from the couch
on the phone, without a sideways scroll and without guessing what the provider is waiting for, and
when the sign-in has to happen on another device the address leaves the console in one copy.

Failure: a long address pushes the dialog sideways, or the owner cannot tell whether the copy
landed, or what the flow wants next, or connecting from the phone means walking to the laptop.

The measurement stays run 1's: does the owner still reach for the console, and how long does it
take to get a provider working on a new machine.

## The foundation clause

One operator today. The interface must later carry a multi-user platform without a rewrite, so this
pass owes foundation — tokens, journeys, a written direction, components that take props — and not
multi-user features or invented personas. Run 3 adds one line: the long-value rules (clip, copy,
never widen the box) and the dialog's state machine are component and token behaviour, not
provider-screen behaviour, so the next surface that shows an address or a code inherits them.

## What "working well" does not mean in run 3

- Not new capabilities: no new providers, no change to where credentials are stored, no change to
  how the worker talks to a provider. The pass runs against what already works.
- Not a new palette, and not a new type ladder: run 1's roles and run 2's phone step stand. A size
  or a state this surface needs is added to the existing ladders, not beside them.
- Not a settings redesign: Defaults and Updates keep their shape unless a shared component has to
  move, and then it keeps the direction in `design.md`.
- Not a prettier list at the cost of the honest one: the state, the source and the model count
  stay, and the 42-row list stays searchable and ordered with the connected first.
- Not multi-user, and not per-user credentials: foundation only, as above.

## The owner's answers carried in from step 01

Confirmed in the message that closed step 01: the whole providers surface, desktop **and** mobile;
"copy buttons where they make sense" as the direction for the address; the fix holds at phone
width. See `01-frame.md`.

## Confirmation

Owner, 2026-10-13: "continue with what you recommend — seeing is the best way to decide." No
line was corrected, and the instruction is recorded as the run's working rule: the gates are
answered by looking at something, not by prose. Step 03 was drafted on that reading, and step 06
serves both the catalogue and the fixed console so the next decision can be made by looking.
