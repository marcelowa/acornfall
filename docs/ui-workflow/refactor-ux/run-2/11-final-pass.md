# 11 — The owner's final pass

Date: 2026-10-12, on the live build (the dev server on the tailnet, proxying the gateway). The
owner looked at the shipped direction on their own phone and gave four notes. All four are
answered below: three in code, one explained and settled by the call named here.

## Note 1 — the gap above the unfolded composer

The owner sent a screenshot: with the keyboard up, a wide empty strip sat between the transcript
and the card, and asked what it was for. It was the drag band (44px) plus the composer's own top
padding (8px) — about 52px of a phone screen, spent exactly while writing.

**Decision: option C — the band is gone.** The pill goes with it: with nothing to drag, a grabber
is a promise the card does not keep. The fold is now the two gestures that already did it:

- leaving the field (tap the transcript, or the phone's own keyboard-down key) blurs it and folds
  the card;
- sending blurs it and folds it.

The card itself is unchanged, so the composer is one row taller with the keyboard up and nothing
else moved. `composer.tsx` lost the band, the pill, the drag handlers and their state; the blur
handler keeps the one path for the fold.

## Note 2 — any focused field stays in view, not just the composer

**Done, in three places, all reading the one keyboard variable:**

1. `Page` (the app root) reserves `--keyboard-inset` at the bottom, so the transcript, the settings
   panes and the composer all lift together — the composer no longer carries the padding alone.
2. `Dialog` is centred on what can be seen, not on the layout viewport: `--dialog-top` moves it up
   by half the keyboard's height and `--dialog-max-height` keeps it scrollable inside the room left
   above. That covers the rename, compact, sandbox and provider-login dialogs at once, because they
   all use the primitive.
3. `Layer` ends above the keyboard too (`bottom-[var(--keyboard-inset)]`), because the new-workspace
   field lives in the workspaces layer.

A story shows it: `UI/Dialog` → `KeyboardUp`, at a phone viewport with the inset set.

## Note 3 — the wide reach rule, and my call

The owner asked what I thought about every button being 44px on a phone, transcript included.
**My call, and it is the owner's to overrule: keep it.** The cost is about 12px per transcript
control, on a surface that scrolls anyway; the gain is one rule with no exceptions to remember and
no second ladder to drift. If the transcript ever feels airy on the phone, the exception belongs in
a named size for inline actions, not in a class at a call site.

## Note 4 — the layer is not modal: explained, and the two rough edges fixed

Plainly: a modal layer blocks the page behind it — clicks are ignored and Tab is trapped. The
workspaces list is closed by the top-left X, which lives in the bar; a modal layer would block that
bar, so the X could not be clicked. That is why the layer is not modal.

Two rough edges followed, and both are fixed rather than explained away:

- **Tab stayed inside**: the layer now loops Tab and Shift+Tab through its own controls, so a
  keyboard cannot wander into the composer behind a layer the eye cannot reach.
- **Focus came back**: closing the layer returns focus to whatever had it before the layer opened
  (Radix cancels its own restore when there is no trigger, which left focus on the body).

What remains, and is accepted: a click on the dimmed pane does nothing (the X and Back are the
ways out), and a screen reader is not told the layer is modal, because it is not.

## Note 5 — desktop: the list is a panel, not a cover (option B)

The owner asked what the layer does on a desktop, and chose option B. From `lg` up the layer is
`--rail-width` wide instead of full width, so it takes the rail's own place and the conversation
stays visible beside it, and the dim pane is gone there (`lg:hidden`) so the conversation stays
readable and clickable rather than sitting behind a scrim.

Two consequences, both handled:

- The bar's toggle is shown on `lg` whenever a layer is open, because the X is the one close and it
  has to be reachable on every width; when no layer is open, the desktop bar carries no rail
  buttons, as before.
- The workspaces content was a page and is now a 280px column: its create row wraps, and its padding
  is the panel's (`md`) rather than a page's (`lg`).

What did not change: clicking the conversation behind the panel does nothing (the X, Back, Escape
or opening a workspace are the exits), and the panel's width is the token, not a dragged rail — the
layer is portalled to the body, so it never sees the `--rail-width` override a drag writes.

## Checks

`typecheck`, `lint`, `check:system` (the probe now carries the dialog and layer classes too),
`format:check`, `bun test` (91 pass), `bun run build:storybook`, `make ui-build`, `make lint` —
green.

## What step 12 writes down

`design.md` gains the phone section: one layer and one close, the fold and what folds it, the
keyboard variable and where it is spent, the 44px reach below `sm`, 16px fields, and the two
ladders that did not change. `icp.md` gains the round-2 panel's verdicts and this pass's notes.
