# 03 — The desired journeys (run 2)

Status: **draft, awaiting the owner's review.** Judgements in `fights today` are the first read of
the code (see `01-frame.md`); the panel in step 04 has not looked yet. Run 1's journeys J1–J6 stand;
this pass touches only J6, and adds five.

## J7 — Send something from a phone with the keyboard up

- Entry: the phone is in hand and the thought is short; the console is open on a conversation.
- Steps: the composer sits folded, one row → tap it, the keyboard rises and the card stays above
  it → type, at 16px so the phone does not zoom → send → the message lands in the transcript, the
  keyboard leaves, the composer folds again.
- Success moment: the sent message is on screen above the composer without a scroll, and nothing
  had to be dismissed to get there.
- Pains answered: 1 (the composer under the keyboard), 2 (a folded composer).
- Today: `fights today`. Nothing in the UI listens to the visual viewport; the page is `h-full`
  inside `#root` with `initial-scale=1` and no `interactive-widget`, so when the keyboard opens the
  card is behind it.

## J8 — Put the composing down, keep the draft

- Entry: mid-draft. The owner wants to read the transcript, or the keyboard is in the way.
- Steps: swipe down from the composer's top border → the field blurs, the keyboard goes, the card
  folds → the draft is still held, and the row says so → tap to resume where they stopped.
- Success moment: the transcript is readable again in one gesture, and the draft survived it.
- Pains answered: 2, 3 (swipe down unfocuses).
- Today: `new`. There is no gesture, and nothing measures a drag against the fold.
- Handle: option B, chosen by the owner (a 40&times;4 pill on the card's top border, in the gap
  above the card). After the step 04 panel: the hit zone is the pill plus the gap, full card width
  and at least 44px tall, outside the card's own text, with `touch-action: none`.

## J9 — Move between conversations from a phone

- Entry: in a conversation, in one hand, wants another one.
- Steps: tap the rail button in the top bar → the drawer slides in from the left edge → the rail's
  own content is inside it (workspace head, list, foot) → pick a conversation → the drawer leaves
  to the left, the conversation is behind it. The X closes it without choosing.
- Success moment: two taps to another conversation, and the way out is the same corner the way in
  was.
- Pains answered: 5.1 (slide from the left), 5.2 (the X), 5.4 (bigger icons).
- Today: `fights today` on the motion and the close: below `lg` the drawer drops from under the top
  bar at full width and closes with a `PanelLeftClose` icon. The rail's content itself is
  `keep as is`.

## J10 — Reach the workspaces list without leaving the conversation

- Entry: the owner needs another workspace, or to name or manage the ones they have.
- Steps: tap the workspace button in the rail head — a labelled button, not a swap icon → the list
  arrives as a layer over the console: the same left slide and the same X as J9 → act on a row
  (open, rename, sandbox, hide) → opening one closes the layer and the rail behind it follows.
- Success moment: the conversation behind the layer was never lost, one X returns to it, and the
  browser URL never changed.
- Pains answered: 5.3.
- Today: `fights today`. It is a destination: it replaces the screen, pushes a URL, and is opened
  from a `ChevronsUpDown` in the rail head with nothing to close it but the browser. The owner's
  decision (step 01): it loses the URL.

## J11 — Check a run from a phone (folded into J7 and J9)

The owner folded this one in on 2026-10-12, on TINKERER's read: every step is already J9 (the rail)
or J7 (the reply), so it is a regression line, not a journey. Kept here as that line:

- Entry: away from the desk, phone in hand. Open the console → one tap brings the rail in from the
  left → the row already says what ran and what it cost → read the last turn → optionally reply →
  close, one hand, inside a minute.
- The line the pass must not break: two taps to the conversation, and the fold never hides run state
  (see the rules below).

## Not journeys: the rules this pass holds everywhere

Like run 1's surface rules, these are constraints on every journey above, and they go to step 05
(the ladder) and step 07 (consolidation), not into a journey:

- **One phone ladder.** Below `sm`, anything a thumb hits is at least 44px, and icons in the bar,
  the drawer and the rail head are 20px — the X included. The owner chose the wide reach on
  2026-10-12: the composer's send and attach, the conversation row's `…` menu, the rail foot and
  the workspaces rows are in scope too. Desktop keeps run 1's ladder.
- **Keyboard first.** One mechanism (`interactive-widget` plus one hook writing `--keyboard-inset`)
  keeps the composer above the keyboard in every state, including the rename and new-workspace
  fields.
- **One shape of navigation.** One left slide, one close: the bar's top-left button, a hamburger
  that becomes an X. The workspaces layer carries no X of its own (owner, option A); opening it
  closes the rail, and Back closes it too. No layer owns a URL.
- **Motion answers the tap.** The slide in and out is the action; the top drop retires; reduced
  motion is respected.
- **The draft is never lost** by a blur, a fold, or a layer opening over it, and the fold keeps run
  state visible: while a stream is reconnecting or the harness is down, its pill stays in the folded
  row.

## What the console fights today

1. The composer under the keyboard (`composer.tsx` has no viewport logic; `Page` is `h-full`).
2. `icon-sm` = 32px with 16px icons in the top bar, the drawer close and the rail head — under the
   44px thumb floor.
3. The drawer's direction and its close icon: `slide-in-from-top`, `PanelLeftClose`.
4. Workspaces as a URL-bearing screen, reached by a swap icon, with no close of its own.

## Next
