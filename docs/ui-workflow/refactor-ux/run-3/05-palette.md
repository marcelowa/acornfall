# 05 — The surface's direction (run 3)

Status: **proposed; the mocks in `06-mocks.md` are this file made visible.** Run 3 adds no hues
and no new steps to the type ladder: run 1's roles (`design.md`) and run 2's phone ladder stand.
What this step decides is the providers surface's own rules — long values, copy, the list's
reading, the dialog's states — every value a token that already exists, no class invented at a
call site (ADR-0016, `make lint`).

Grounded in the owner's frame (`01-frame.md`: the long address that scrolls sideways; "general"
improvements; copy where it makes sense; both widths) and in what the step 03 journeys ask
(`03-journeys.md`, R1–R5).

## 1. Long values: one chain, one rule

A value that can be long — an authorization URL, a device code, a key, a source path, a provider
name, a provider's refusal — may never widen its container. Three mechanisms, each in one place:

- **The container chain.** A grid or flex item keeps `min-width: auto` unless something says
  otherwise, so the dialog's own primitive now lets every child shrink (`[&>*]:min-w-0` on
  `DialogContent`). One line, every dialog in the console, not just this one. Measured: the
  OpenRouter address took the dialog's content from 1465px to 446px at a 1200×800 viewport.
- **A value clips.** `ClippedText`: one line, ellipsis, and the whole of it on hover, focus or
  tap. It is what the address row and the list's state line use.
- **Prose wraps.** A sentence that may carry a value inside it (instructions, a refusal, the
  progress line) takes `wrap-anywhere`, the same rule the transcript uses for a pasted token.

Where it is checked: `tools/check-ui.mjs` gains the measurement — open the sign-in dialog with a
long address and assert that neither the dialog nor the page has horizontal overflow (step 08).

## 2. Copy where copying is the point

- **Gets a copy**: the sign-in address (Copy address), the device code (Copy code). These are the
  two things whose whole purpose is to leave the console — to another device, or another app.
- **Does not get one**: the state line's source (`OPENCODE_API_KEY`, an ADC path) is a fact to
  read, and the provider id is not shown at all. A copy button that copies something nobody pastes
  is noise on a surface that already has 42 rows.
- The control says it copied (`CopyButton`: "Copied", 1.2s), and it is a 44px target below `sm`
  like every other action (run 2's ladder).

## 3. The list's reading

- **Two named groups with counts**: `Connected (n)` first, then `Not connected (n)`. The order is
  already right; the labels make the answer to "what can this install use" arrive before a scroll.
  While a search is on, the groups narrow with it (a count of matches, not of the catalogue).
  Rows sort by the name they show, not by id (panel finding: `OpenCode Zen` before `OpenCode Go`
  is the id order, and a person reading names reads it as wrong).
- **Re-check beside the search**, not 42 rows below it: the person who just added a key outside
  the app is looking at the search row. And it says what it read — "Read 42 providers just
  now." — because the panel's verdict on a silent control was that it would stop pressing it
  (panel finding, `04-panel-journeys.md`).
- **A dead connection is its own state**: a stored credential whose check fails reads "Not
  working · key stored", in the warning tone, with Reconnect — not "Not connected". Making it
  real needs one field from the worker (`stored` with `authenticated: false`); until then the
  mock carries the direction (panel finding: a stopped provider is not representable, so the
  check-in surface cannot catch it).
- **The search clears in one gesture** (a clear control, and Escape), and its empty state names
  the catalogue's words: the panel typed `claude` and got silence while Anthropic sat six rows
  away. The hint is copy now; searching model names would be a platform change.
- **The state line clips** (`ClippedText`), in mono `2xs` so the values (a source, a count) are set
  apart from prose (panel finding, R4), because a source can be 57 characters and a clipped fact
  nobody can read is a lost fact.
- Search, groups and rows are the same primitives as today; nothing new is introduced.

## 4. The dialog's states

One state machine, named, so the dialog can never be silent about what it wants:

| State | What the person sees |
|---|---|
| `waiting` | The method choice; a picked method says "Starting…" and cannot be picked twice |
| `asking` | The provider's question — field or choices — with its own submit label (Save / Continue) |
| `working` | One status line: the provider's newest words, or "Starting…" / "Finishing…". Instructions stay |
| `done` / `failed` | What happened, in the provider's words when it has them, and the next step (Close, or Try again) |

Rules: instructions (address, code) are sticky; a prompt replaces a prompt and is withdrawn when
the provider resolves it; a refusal wraps inside the dialog and never widens it; the only exit
while a flow runs is the labelled Cancel.

## 4b. The frame and the slots (the owner's finding)

The dialog is a frame with **three slots**, and every state fills the same ones:

- **the ask** — one line of words, in the provider's own voice (its question, its instructions, or
  the flow's own "Starting…" / "Finishing…");
- **the controls** — what the person acts on, in the same order every time: the addresses and
  codes, then the choices, then the field;
- **the action** — one button, full width, pinned to the bottom of the body.

The body is never shorter than `--connect-body-min` (176px, 256px below `sm` — the phone states
wrap to more lines and every control is at the 44px step), so a state change moves the words and
not the panel. Measured at 1200×800: every state 357px tall at top 222 (before: 300/280/320/256 at
tops 250/260/240/272); at 390×844: every state 448px at top 198 (before: 288/305/305/397, tops
278/270/270/224). The action button lands at the same y in every state that has one.

The token carries its own phone step in `tokens.css` rather than in `globals.css`'s phone ladder:
a step written in `@layer base` loses to an unlayered token file, which is why the type ladder can
live there and this cannot.

## 5. What does not change

- No new tokens, no new type step, no new colour. The classes the mocks use are the product's.
- The dialog stays `max-w-md`, the section keeps its order, its search and its two-step disconnect.
- Desktop keeps run 1's ladder; the phone keeps run 2's 44px step and 16px fields.
