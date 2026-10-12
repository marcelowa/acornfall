# 09 — Build for real

Date: 2026-10-12. Journey by journey, against the approved direction (steps 05–06) and the mocks
shown in step 06. Every mock is deleted: `ui/src/mocks/` is gone, because every direction it argued
for is in the app. Nothing here re-decides anything; where a mock and the code disagreed, the code
followed the mock.

## What shipped, journey by journey

**J7 — send from a phone with the keyboard up.**

- `lib/keyboard.ts`: one hook, `useKeyboardInset`, reads `window.visualViewport` and writes the
  distance the keyboard covers to `--keyboard-inset`. Called once, in `app.tsx`. Android's side of
  the same problem is the viewport meta (`interactive-widget=resizes-content`), so there the layout
  viewport shrinks and the inset is zero.
- The composer reserves it: `pb-[var(--keyboard-inset)]`, and the token is declared in `tokens.css`
  (0px) so the class always resolves. The composer is `shrink-0`, so the transcript is what gives
  way, not the card.
- The draft stays at 16px (`lg`), which is also why a phone does not zoom the page when the field
  takes focus.

**J7/J8 — the folded composer and the band.**

- `folded` and `onFoldedChange` are props; the app owns the flag (`workspace-view.tsx`), so the
  draft and the fold survive the composer unmounting when a screen shows. The fold is the phone
  layout: `lib/media.ts`'s `usePhone()` is true below `sm`, the same line as the rest of the phone
  ladder — which is also what makes the state reviewable in Storybook at a phone viewport.
- The folded row: the pill on the top border, the draft's first line (or the placeholder), and every
  action — Stop, Steer, Queue and Send are never behind a tap.
- **The band** (option B, as approved): the pill plus the gap above the card, full card width, 44px
  tall, `touch-none`, and only below `sm`. Drag 24px down and the composer blurs and folds; while
  folded there is nothing to put away, so there is no band.
- One fold path: leaving the composer folds it (`onBlur`, unless focus moved to another control
  inside it), and the band's swipe calls the same thing. A tap on the folded row unfolds it and
  asks for the caret — in an effect, because the field does not exist yet on the fold, and because
  a phone only opens its keyboard for a gesture.
- Sending blurs and folds, so the message that just landed is what the reader sees.
- **Run state stays visible**: the pills moved from the controls row to `ambient`, which renders
  above the card in both states (that is where the mock put them). The folded row also carries an
  attachment count, so a send that is off while files upload says why.
- `focusToken` (a new conversation) unfolds the card on a phone without taking the caret: the rule
  is that the composer never pops the keyboard on its own.

**J9 — move between conversations from a phone.**

- All of it came from step 07: one `Layer`, one close (the bar's toggle), the left slide, and the
  bar at `--bar-height`. What changed here is only what it took to be true: the phone layer is the
  same component as the desktop drawer's, and the drawer's own close row is gone.

**J10 — the workspaces list without leaving the conversation.**

- Settings stay a screen; the workspaces list became a layer: `Layer` with `belowBar`, opened by
  `platform.openWorkspaces()` and closed by `platform.closeWorkspaces()`.
- The rail head's swap icon is gone. `components/workspace/workspace-button.tsx` is the workspace's
  own name as the button that opens its list, with a chevron that only says it opens something.
- Opening the layer closes the rail (one layer at a time; two left layers would put two X's in one
  corner).
- **No URL**: `Screen` is `"conversation" | "settings"`; `routeFromUrl` no longer knows
  `/workspaces`, so an old link lands on the conversation. **Back closes the layer**: the `popstate`
  handler closes it and puts the same entry straight back, so the conversation behind never moves.
- The layer's content is the former screen, minus its Back button: the bar's X, Back, or opening a
  workspace are the ways out. `data-slot="workspaces-screen"` and `data-slot="workspace-row"` stay,
  because the browser suite reads them.

**J11 (folded into J7/J9) — the phone check-in.**

The regression line holds in code: two taps to a conversation (rail button, row), and the fold
never hides run state (the ambient pills stay in the folded row).

## Also changed, because the direction required it

- `components/ui/button.tsx` and the field primitives carry the phone step (step 07); nothing here
  sets a size at a call site.
- `tools/check-ui.mjs` follows the layer: it presses `[data-slot=workspace-button]`, waits for the
  layer instead of a `/workspaces` path, and asserts the address does **not** change.
- `ui/test/url.test.ts` is new: the workspaces list is no longer an address, and the other routes
  still resolve as they did.

## The catalogue

Deleted: `ui/src/mocks/` (nine stories), and `Mocks` left the story sort order. Added, in the real
catalogue: `Conversation/Composer` gains `Folded`, `FoldedWithDraft` and `FoldedWithStatus`;
`Layout/Layer` and `Layout/Split` (phone layer open) cover the navigation; `Screens/Workspaces`
covers the rows.

## Checks

`bun run typecheck`, `bun run lint`, `bun run check:system`, `bun run format:check`, `bun test`
(91 pass, 5 new), `bun run build:storybook`, `make ui-build`, and `make lint` at the root — all
green, run as the journeys landed.

`make ui` (the browser suite) could not run: no browser in this sandbox. It was updated for the
layer, and it is the owner's to run.

## How to look

`bun run dev` in `ui/` forwards `/api` to the gateway, so the real app is on the tailnet without
touching the running gateway:

- http://100.112.224.8:7800 — the shipped direction, live, with the gateway's own data.

The gateway binary on :7777 embeds the bundle it was built with, so it still serves the previous
build until it is rebuilt and restarted (which stops its sandboxes).

## One deliberate deviation, named

The step 06 target story showed today's control beside the new one. The phone step is real now, so
that comparison could not survive as pixels — it became "was 32px → now 44px" in words, and the
check-system probe list carries the classes. Found and written down rather than quietly dropped.
