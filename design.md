# design.md

The console's direction, as shipped. Written at the end of the `refactor-ux` chain
(`docs/ui-workflow/refactor-ux/`) so the next session — human or agent — starts from the decided
direction instead of re-deriving it. The system it builds on is ADR-0016: three token layers,
semantic classes only, screens without classes, Storybook as the design surface.

## What the console is for

A local-first agent console for one technical operator. A Go gateway supervises a bun worker and a
microVM sandbox per workspace; `ui/` is the only face of it. Working well means the operator can
find the right conversation in a rail of dozens, read a long tool-heavy turn without losing their
place, intervene mid-run with no doubt about what the control does, change a setting once and know
it stuck, and see what the model saw and what it cost — without dropping to a terminal. The
operator is one person today; the interface must carry a multi-user platform later without a
rewrite (see the foundation note at the end).

## Palette

Bronze on warm bark, blue as the second voice. The hues were already there; this pass settled what
each one is *for*:

| Role | Token | Why |
|---|---|---|
| Action, running, selection | `--primary` (brand-500 light, brand-700 dark) | one warm accent for the thing to press and the thing happening |
| Facts: spend, tokens, ids, ages | `--muted-foreground`, mono, `tabular-nums`, one step (`2xs`) | a fact must be comparable down a column and never compete with a title |
| Queue, Stop | `--secondary` | the second voice, separated from action |
| Warning / failure | `--warning` ember / `--destructive` | one warm family, two jobs |
| Small status text on a card | `*-subtle-foreground` tokens | the strong tones sit under the small-text contrast floor in dark |
| The rail | `--rail` | the rail recesses one step from content in both themes |

A run that stops moving keeps its dot and loses the accent (`StatusDot`'s `stale` state), because a
promise the run no longer shows is worse than no dot at all. No new ramp was added; the direction
was roles, not hues.

## Type

One ladder, honest at both widths. Below 640px every step up to `base` moves one notch, so chrome
never reads as content and nothing collides:

| Step | Desktop | Phone | Used for |
|---|---|---|---|
| `2xs` | 11 | 12 | ids, timestamps, cost, kbd |
| `xs` | 12 | 13 | badges, captions, dense meta |
| `sm` | 13 | 14 | the UI default: rows, forms, buttons |
| `base` | 14 | 15 | panel prose, list body |
| `lg` | 16 | 16 | the transcript body, and the composer's draft: what you type is the size of the message it becomes |

The draft being `lg` is the fix for the smallest print in the console having been the text being
typed. Mono is for ids, timestamps, cost and code — never for prose.

## Layout and controls

- The rail is 280px, draggable to about 192px. A row is a dot column, a title, and a second line:
  spend on the left, age on the right, always present so rows do not change height when they learn
  their first token, and so the age is the last thing a narrow rail drops.
- A card folds from its header, where the reader is, to **two lines**, with the count on the
  control. Folding past ten lines is the owner's deliberate choice: a twelve-line output needs a
  click, and the count is what keeps that honest.
- Output or reasoning that was open while a run was live stays open when it settles: the entries
  are keyed by what survives the wire (a tool call's `callId`, a thinking block's own opening
  words), not by the transcript id, which changes.
- Icons step 12 / 14 / 16 / 20px; buttons 24 / 32 / 36 / 40px; rows 24 / 32 / 40px. One row height
  per surface rather than per call site.
- Truncated text is one gesture from being read: `ClippedText` shows the whole string on hover, on
  focus and on tap, and shows nothing when the text fits.
- Prose wraps anywhere (`wrap-anywhere`), so a pasted token, hash or data URL cannot widen the
  console; the transcript also clips its own width, so a future miss cannot scroll the app
  sideways. Only a code block scrolls, inside itself.
- Motion answers an action or reports live state — never on mount, never on scroll, and always
  under the global reduced-motion guard.

## Journeys

These are the product's defined paths, and what each one shipped in this pass
(`docs/ui-workflow/refactor-ux/03-journeys.md`):

1. **Resume the right conversation** — the rail row carries spend and when it last moved, so a
   check-in is one look rather than a hover, and a dead run stops looking alive.
2. **Pick up another workspace** — the workspaces screen names and manages them; a row's menu opens
   its sandbox (image, network) and its rename, and the row wraps on a phone.
3. **Read a long, tool-heavy turn** — turn rhythm, cards that fold to two lines from the header,
   output that stays open across a settle.
4. **Intervene in a live run** — three labelled choices, one meaning each; a message keeps the mark
   it was sent with ("steered this turn" / "queued behind the turn"); Enter does what the buttons
   offer, and the composer says which.
5. **Change a setting once and know it stuck** — one commit moment per page: fields apply as chosen
   or from their own button, and the outcome appears where the field sits.
6. **Check on a run from a phone** — the rail is one tap away in the layer, the folded composer
   shows the draft and keeps Stop, and a check-in is two taps and no dismissal.
7. **Send from a phone with the keyboard up** — the card folds to one row, a tap opens it above the
   keyboard, and sending folds it back with the message on screen.
8. **Put the composing down, keep the draft** — leaving the field (or sending) folds the card and
   the draft is still there, shown in the folded row.
9. **Move between conversations from a phone** — one button in the bar, one left slide, one X in
   the same corner as the button that opened it.
10. **Reach the workspaces list without leaving the conversation** — the workspace's own name opens
    the list; on a desktop it is a panel beside the conversation, and no address changes.

## The phone

Run 2 (2026-10-12) made the phone a surface of its own instead of a shrunken desktop. What is
settled, and what a later pass may build on:

- **One layer, one close.** The conversation rail and the workspaces list arrive the same way:
  full width below `lg`, slid in from the left, out to the left, 200ms, under the reduced-motion
  guard. Neither carries a close of its own — the bar's own toggle is the X, which is why a layer
  starts *below* the bar (`--bar-height`), why it is not modal (a modal layer blocks the bar it is
  closed from), and why the dim pane does not close it: a stray tap never loses your place. Tab
  stays inside the layer and closing it returns focus where it came from.
- **From `lg`, the list is a panel, not a cover**: the layer is `--rail-width` wide and the dim is
  gone, so the conversation stays readable and usable beside it.
- **The layer keeps no URL.** `/workspaces` is not an address: opening the list pushes an entry
  carrying the address it already has, so Back closes the list without moving the page, and an old
  link lands on the conversation.
- **The composer folds below `sm`**: the phone's rest state is one row that shows the draft's own
  first line, and it keeps every action, so Stop is never behind a tap. Leaving the field folds it;
  sending folds it. There is no drag band and no grabber — a 44px band above the card cost 52px of
  the screen while typing, and the two gestures above already did the job (the owner cut it).
- **The keyboard is one variable.** `lib/keyboard.ts` writes `--keyboard-inset` from the visual
  viewport; the app root reserves it, dialogs centre on what can be seen (`--dialog-top`,
  `--dialog-max-height`), and the layer ends above it. Any field that takes focus stays visible.
- **One thumb ladder.** Below `sm` every button is 44px with a 20px chrome icon, menu items are
  44px, and the bar is 56px. `xs` is included on purpose: one rule with no exceptions. Fields print
  at 16px there so iOS does not zoom. Desktop keeps 24/32/36/40 buttons and 12/14/16/20 icons.
- **Run state survives the fold**: the reconnecting and harness-down pills sit above the card in
  both states, and a run whose last move is half an hour old stops claiming to be live — in the
  composer too, not just in the rail dot.

## Writing

Sentence case, active voice, and the interface's own voice rather than a person's: "Show all
(64 lines)", "Refused: no image by that name", "Enter steers this turn · Shift+Enter is a newline".
People manage conversations and sandboxes, not records and jobs. A refusal says what happened and
how to fix it, in the server's own words where they exist.

## The foundation for a multi-user platform

This pass owes a foundation, not multi-user features. What is deliberately in place: tokens with a
single direction (`tokens.css` + `globals.css`), components that take what they need as props,
screens without classes, journeys written down, and this document. What is deliberately absent:
personas that do not exist yet, tenant scoping, and any claim that the rail's "one operator" shape
is a multi-user design. `icp.md` records why the panel reviewed with one person in three modes.

## Evidence

- ADR-0016 — the design system and its enforcement.
- `docs/ui-workflow/refactor-ux/` — run 1's chain (frame, goal, journeys, both panels, palette,
  mocks, consolidation, doctor, build, the owner's pass) and `run-2/`, the phone pass: the same
  twelve steps over the composer, the bar and the two layers.
- `docs/ui-design-spec.md`, `docs/ui-workflow/99-ui-design-spec.md` — the October spec this pass
  revised.
- `docs/ui-workflow/milestones.md` — what shipped before, with the claims this pass superseded
  marked in place.
