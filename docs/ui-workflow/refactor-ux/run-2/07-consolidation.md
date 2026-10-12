# 07 — Consolidate

Date: 2026-10-12. Structural pass only: step 09 wires the approved direction (steps 05–06) on top
of this. Nothing here invents a design decision; every merge below is one of the approved ones,
put in one place.

## What was inventoried

| Where | Duplication found | Done |
|---|---|---|
| `components/layout/split.tsx` (phone drawer, hand-rolled over Radix) and `components/ui/sheet.tsx` (`SheetContent`, side left) | Two layer implementations: one slid from the top with a close row of its own, one slid from the left; the same job, two shapes | Merged onto `components/layout/layer.tsx`; `ui/sheet.tsx` deleted |
| `split.tsx` | Two closes for one layer: the bar's toggle and the layer's own `PanelLeftClose` row in the opposite corner | One close: the bar's toggle, a hamburger that becomes an X |
| `split.tsx` | The bar height written twice (`h-12` on the bar, `top-12` on the drawer) | One value: `--bar-height` (48px, 56px on a phone), read by the bar and by the layer's top and overlay |
| `components/ui/button.tsx` | The phone step lived at call sites (the mocks carried `size-11` and `size-5` by hand) | The `cva` steps every size to 44px below `sm`, and the chrome size takes a 20px icon there |
| `components/ui/input.tsx`, `textarea.tsx` | Fields printed at 15px on a phone, so iOS zoomed the page a field opened on | `max-sm:text-lg` in each primitive: 16px, once |
| `components/workspace/workspaces-screen.tsx` | The workspace row was inline in the screen, and the phone layer needs the same row | Extracted to `components/workspace/workspace-row.tsx` |

## What merged, and where

1. **`components/layout/layer.tsx` — the one layer.** Full width, slid in from the left and out to
   the left, `belowBar` when a bar is above it, `sr-only` title, and deliberately not modal: a
   modal layer blocks the bar it is closed from, and an outside-click close would race the same
   button (the X would close and reopen in one gesture). `onInteractOutside` is prevented for the
   same reason — the bar's toggle and Back close it, a stray tap on the dimmed pane does not.
2. **One close.** `Split` no longer renders a close row inside the layer; its toggle in the bar is
   the only one, in the same corner for opening and closing. This also returns 44px of phone height
   to the conversation list, which DELEGATOR asked for.
3. **`--bar-height`.** A semantic token in `tokens.css` (48px) with the phone step beside the rest
   of the phone ladder in `globals.css` (56px). The bar, the layer's top edge and its overlay all
   read it, so a 44px target can never push the layer out of alignment again.
4. **The phone step, once.** `Button`'s `cva` now carries `max-sm:` steps for all eight sizes, and
   `icon-sm` (the chrome size: bar, rail head, drawer) takes its icon to 20px below `sm`. The
   editor step did not change. This is what makes the mocks' target table real without a class at
   any call site.
5. **Fields at 16px on a phone** in `Input` and `Textarea`.
6. **`WorkspaceRow`** — the screen and the phone layer now read one row, and the `data-slot` and
   `data-name` attributes the browser suite keys off are unchanged.

## What stayed, and why

- **The row menus** (`conversation-row.tsx`, `workspace-row.tsx`): an items-prop abstraction over
  fifteen lines each would cost more than the duplication, as in run 1.
- **The composer's card**: the folded row is a state of the same card, not a second card, so it
  belongs in step 09 with the component that owns it.
- **`Sheet*` in the app** — gone: nothing imported it but `Split`, and there are no `Sheet` stories.

## Effect on the step 06 mocks

The `Mocks/Phone — targets` story used to show today's size beside the new one. The ladder is real
now, so both columns rendered the same: it shows one sample per control with the change written
under it instead ("was 32px → now 44px"). The other nine mocks dropped the size classes they
carried by hand and now show what the ladder produces.

## Verification

`bun run typecheck`, `bun run lint`, `bun run check:system`, `bun run format:check`, `bun test`
(86 pass), `bun run build:storybook`, and `make lint` at the root (gofmt, go vet, staticcheck, the
house rules, worker and interface lint, check-system, format) — all green. The compiled CSS was
inspected for the two rules that cannot be seen headless: `max-sm:size-11` and
`max-sm:[&_svg…]:size-5` are emitted after the base sizes, so they win at the same specificity, and
`--bar-height` resolves to 48px with a 56px phone override.
