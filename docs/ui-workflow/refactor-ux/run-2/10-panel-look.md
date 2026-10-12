# 10 — Panel on the look (round 2)

Date: 2026-10-12. Same three personas from `icp.md`, given the diff on `refactor-ux-2-mobile`, the
run's own notes, and the stories. None could run the app or see pixels (no browser in this sandbox)
and each said so. Full feedback below, then what was fixed, and the three things left standing with
the owner's call.

## OWNER-OPERATOR

> **Keep** — the fold keeps the draft's words and every action (`composer.tsx:337-365`); the ambient
> pill renders above the card in both states (`:336`), so a dropped stream cannot hide; one left
> slide for both layers; 16px fields; `--bar-height` named once; the fold flag lives in the view
> model (`workspace-view.tsx:87`), so a screen does not eat the draft.
>
> **Cut** — the pill in the folded row (`composer.tsx:344`). Folded, there is no band and no
> handler; the pill draws a drag that does not exist. Cut it, or make the folded row draggable.
>
> **Confused by** — the workspaces layer has no close I can find.
>
> 1. The bar's toggle is bound to the rail alone (`shell.tsx:69`, `split.tsx:161-172`), and
>    `openWorkspaces` only closes the rail (`use-platform.ts:756-759`). With the list open the bar
>    shows a **hamburger**, not an X. Tap it and you get two layers at z-50, rail and list, both
>    open. J10's "one X returns to it" is not shipped.
> 2. Back: nothing pushes an entry when the layer opens (`use-platform.ts:756`). The handler closes
>    the layer and pushes the URL it has *just landed on*, without `setRoute`
>    (`use-platform.ts:392-402`). So Back jumps the address to the previous entry while the screen
>    keeps the old conversation; reload lands elsewhere.
> 3. Keyboard: only the composer reserves the inset (`composer.tsx:331`). The rename and
>    new-workspace fields get nothing (`rename-dialog.tsx:53`).
> 4. The caret on unfold is taken in an effect (`composer.tsx:173-182`), outside the tap. iOS often
>    refuses the keyboard there. I cannot test it; it is the one thing that decides J7.
> 5. `workspace-button.tsx:31` prints a 16px chevron where 05-palette §2 says 20px; `:24` is
>    `min-h-11` at all widths, so the desktop rail head grows.
> 6. `dropdown-menu.tsx:58` is about 30px on a phone. The `…` trigger was stepped, the items were
>    not.
> 7. `layer.tsx:56` slides in 300ms; 05-palette §4 says 200ms.
> 8. The band is `touch-none` (`composer.tsx:383`), 44px, right where a thumb starts a scroll.
>
> **Would I keep using this** — the composer, yes, folded, from the couch. The workspaces layer,
> no: I open it and lose my way out, and Back moves the address under me. Fix the close and Back,
> and this pass is real.

## DELEGATOR

> **keep** — The fold hides nothing that matters: `ambient` renders above the card in both states
> (`composer.tsx:337`), and Stop/Steer/Queue stay in the folded row (`:361`). The bar stays mounted,
> so the run dot survives while a layer covers the console.
>
> **cut** — The drag band, `composer.tsx:379-399`. It buys a gesture the fold already has: blur
> folds it (`:407`) and send folds it (`:209`). It costs 44px of transcript on every phone while
> writing.
>
> **confused-by** —
> 1. A dead run keeps a Stop button. `workspace-view.tsx:325` computes the honest state for the bar,
>    but `:624` hands the composer the raw `busy` flag. So the rail dot dims and the bar dot dims,
>    and the folded composer still says a run is happening. My loudest "alive" reading is the one
>    that never expires.
> 2. The workspaces layer has no X (same finding as above, with `tools/check-ui.mjs:162-180` running
>    at desktop width where the phone case is untested).
> 3. The folded row's own tap is under 44px: `composer.tsx:348-360` is a hand-rolled button,
>    `py-2 text-lg` ≈ 38px, no `min-h-11`, not a `Button`, so the probes miss it.
> 4. `composer.tsx:367` prints "1 files · 1 uploading".
>
> **would I keep using this** — Yes on the phone for the check-in. No until the workspaces list has
> the close this pass says it has, and a stale run stops pressing Stop.

## TINKERER

> 1. **The promised X does not exist for the workspaces layer.** `split.tsx:153-162` turns the bar's
>    toggle into an X from `railOpen` only. Real exits: Escape (a Radix default, not written down)
>    and Back.
> 2. **Back is worse than "closes the layer".** `use-platform.ts:349-352` is false; on popstate the
>    browser has already moved the location, so `:397-401` re-pushes the previous page's URL while
>    `:402` returns before `setRoute`. Screen and address bar disagree.
> 3. **Visually modal, mechanically not.** `layer.tsx:54` blocks interact-outside, but Tab walks out
>    into the composer behind it, and with no `Dialog.Trigger` Radix cancels the focus restore, so
>    Escape drops focus to `document.body`.
> 4. **Checkable?** Partly. The type union enforces "no screen for the list" and `url.test.ts` covers
>    the parse. The phone step is not enforced: `check-system.ts:106` probes `max-sm:size-5`, but the
>    shipped class is `max-sm:[&_svg:not([class*='size-'])]:size-5`.
>
> keep: one keyboard variable; the fold in `workspace-view.tsx`; 16px fields; one `Layer`.
> cut: `xs: "h-6 … max-sm:h-11"` — 24→44px on every transcript action button, and it eats the phone
> transcript. confused-by: a hamburger over an open list; URL and screen disagreeing after Back.
> would I keep using this: yes at the desk; not on the phone until the list has a visible close.

## What was fixed in the build (all three findings the panel agreed on)

1. **The layer has its close.** `Split` and `Shell` take `appLayerOpen` / `onAppLayerClose`: the
   bar's toggle shows the X whenever *any* layer is open and closes the app's layer first. Opening
   the list no longer leaves a hamburger over it.
2. **Back is honest.** Opening the layer pushes its own history entry carrying the same address, so
   Back consumes that entry and the address never moves; the popstate handler no longer re-pushes a
   URL it has just landed on.
3. **A stale run stops pressing Stop.** The composer is handed `run === "running"` instead of the
   raw busy flag, the same rule the rail dot and the bar dot already follow.
4. **The folded row's tap is 44px** (`min-h-11`), and its count line reads "1 file".
5. **The folded row has no grabber**: nothing to drag there, so nothing promises a drag.
6. **The workspace button** is 44px with a 20px chevron on a phone, and the compact rail row from
   `sm` up — desktop keeps its height.
7. **The layer slides in 200ms**, as step 05 said.
8. **Menu items are 44px on a phone** (dropdown and context menus), because a thumb hits those too.
9. **The probe names the shipped class** (`max-sm:[&_svg…]:size-5`), not a neighbour that passes.

Checks after the fixes: `typecheck`, `lint`, `check:system`, `format:check`, `bun test` (91 pass),
`bun run build:storybook`, `make lint` — green.

## What was left, and why — the owner's call

1. **The band** (owner chose option B in step 06; DELEGATOR would cut it and let blur and send do
   the folding). It costs 44px of transcript while the card is open.
2. **The keyboard inset covers the composer only.** Step 04's own panel said "cut it back to the
   composer" when the general clause pulled in the rename and new-workspace fields; the round-2
   panel wants them covered. Written down as a limit rather than changed in a fix round.
3. **The phone step also reaches `xs` buttons**, so a transcript action button is 44px on a phone.
   The owner chose the wide reach in step 04; TINKERER reads it as transcript height lost.
4. **Non-modal is a deliberate trade**: a modal layer blocks the bar's own X, which the one-close
   decision needs. Tab can leave the layer and Escape leaves focus on the body; both are named here
   rather than discovered later.
