# 05 — The phone ladder (run 2's direction step)

Status: **awaiting the owner's confirmation.** Run 2 adds no colour: the palette, the type ladder
and the size ladders from run 1's `05-palette.md` stand. What this step decides is the phone's own
step, the keyboard mechanism, and the shape of the two layers — every value a token that already
exists (`ui/src/styles/tokens.css`), no class invented at a call site (ADR-0016, `make lint`).

Grounded in the step 04 panel and the owner's gate answers: one close, top-left; the drag band;
Option A for the workspaces layer; Back closes the layer; the wide reach rule; J11 folded in; the
folded row keeps run state.

## 1. Reach: the wide rule, below `sm` only

Below 640px, **every control a thumb hits is at least 44px** (`--base-space-11`, `size-11`). The
boundary is the same one the phone type ladder already uses (`max-sm`, `globals.css:203`). Desktop
keeps run 1's ladder; nothing above `sm` changes.

Named in the frame: the the top bar's buttons, the drawer's close, the rail head's buttons.
Named by the panel, now in scope: the composer's send and attach (`size=icon`, 36px today), the
conversation row's `…` menu (24px, shown on touch), the rail foot's two buttons (32px), the
workspaces rows' buttons (24px).

Mechanism, one place: `Button`'s `cva` gains a phone step (`max-sm:size-11` on the sizes a thumb
reaches), and the few hand-rolled targets (rail foot, workspaces row) take the same class. That is
TINKERER's "name the stepping component", and the classes go into the `check-system.ts` probe list
so a phone target that shrinks again fails the check.

## 2. Icons: one size in the bar, 20px

Icons in the top bar, the drawer and the rail head are **20px**, the X included. The panel's catch
stands: a 24px X beside 20px icons is two sizes in one row. 20px keeps the ladder and still reads
at arm's length; the X is told apart by being the close, not by being bigger. Desktop keeps
12 / 14 / 16 / 20.

## 3. Fields: 16px on a phone

On a phone, `input` and `textarea` print at 16px (`lg`), so iOS does not zoom the page when the
field takes focus. The label stays at its own step. This is one rule in the field primitives, not a
per-screen fix, and it covers the rename dialog and the new-workspace input the panel named.

## 4. One navigation shape

- Both layers slide in **from the left edge**, 200ms, and out to the left the same way, under the
  reduced-motion guard. The phone drawer's top drop retires; the two implementations
  (`split.tsx:250` and `sheet.tsx:36`) become one.
- **One close, top-left**: the bar's own button, a hamburger that becomes an X while a layer is
  open, in a 44px target with a 20px icon. The drawer's own close row goes — the 44px it cost the
  list come back to the list.
- **The workspaces layer has no X of its own** (owner, option A). Opening it closes the rail; the
  bar's X, or Back, or opening a workspace returns to the conversation. No URL, and a saved
  `/workspaces` reload lands on the conversation.
- The bar's height stays one number, named once, so the 44px step moves the bar and its offsets
  together (the panel found `h-12` and `top-12` hard-coded apart).

## 5. The keyboard: one mechanism

`index.html` gets `interactive-widget=resizes-content` (Android), and one hook
(`useKeyboardInset`) reads `window.visualViewport` and writes `--keyboard-inset` on the root; the
composer's reserved height and the transcript's height read that one variable. iOS moves the visual
viewport rather than shrinking the layout one, which is why the meta alone is not the answer. One
hook, one variable, named in the plan — the pass's own rule, and the thing the panel said had no
owner.

## 6. The composer: folded, and what the fold keeps

- Fold state lives in the view model, not in `Composer`: the panel found the component unmounts
  when a screen shows (`workspace-view.tsx:607`), and the draft must survive that.
- **Folded row** = pill, the hint line, and send. The pickers (model, thinking, agent) hide. The
  draft is shown, not an empty placeholder, so a fold never looks like a lost draft.
- **Run state stays**: while a stream is reconnecting or the harness is down, the pills stay in the
  folded row (owner, 7). DELEGATOR's rule: a fold that hides a dropped stream makes a dead run look
  alive.
- **A reason when send is dead**: an upload in flight keeps a chip count in the folded row, because
  `canSend` is false there today with nothing saying why (`composer.tsx:103`, `:210`).
- **The drag band** is the pill plus the gap above the card, full card width, 44px tall, outside
  the card's own text, `touch-action: none`. It exists while the composer is open. The pill is the
  mark, not the target.
- **Send blurs** (`composer.tsx:145` does not today), and a fold is not animated: the keyboard's
  own motion is the animation.

## 7. What this does not change

The hues, the desktop ladders, the rail row's content, the transcript's 16px body and 32/16
rhythm, the tool-card fold, the settings commit moment, and every journey run 1 shipped. No new
token is added: 44px, 20px and 16px all exist.

## Confirmation needed

1. The wide reach rule, below `sm`, with the four panel-named controls in scope (§1).
2. One bar icon size: 20px, the X included (§2).
3. Fields at 16px on a phone (§3).
4. One left slide, one top-left close, workspaces with no X of its own (§4).
5. One keyboard mechanism: the meta plus one hook writing `--keyboard-inset` (§5).
6. The folded row's content, run state kept, dead-send reason, and the band (§6).
