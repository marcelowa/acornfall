# 04 — Panel on the journeys (run 2)

Date: 2026-10-12. One sub-agent per persona from `icp.md`, each given its persona block verbatim,
the run's goal, the five journeys and the decisions already taken (workspaces layer without a URL,
handle option B, phone-first sizes). Each read the code and cited it; none could run the app (no
browser in this sandbox) and each said so. Full feedback below, and the decisions the owner was
asked to take from it.

## OWNER-OPERATOR

> No browser here, so I read the code. I cannot check motion or the keyboard on a real phone — that
> limits me.
>
> **J7 — approve with changes.** The 16px claim holds (`composer.tsx:206`, `tokens.css:133`). But
> the fix is not written: `index.html:5` has no `interactive-widget`, and nothing in `ui/src` reads
> `visualViewport`. iOS ignores that meta, so there the card still goes under the keyboard. Name the
> one place in step 09, or it becomes a per-screen fix — the thing the pass forbids. Also, the send
> path does not blur (`composer.tsx:145`), and the journey does not say what the folded row shows.
>
> **J8 — approve with changes.** The draft survives a fold: it lives in `WorkspaceView`, cleared
> only when the conversation changes (`workspace-view.tsx:110`). "the row says so" needs words — the
> folded row must not look like an empty composer. And the rule says 44px for a thumb, but the pill
> is 40x4 and the sketch's zone is 28px. Pick one; do not hold both.
>
> **J9 — approve with changes.** "the way out is the same corner the way in was" is false in the
> code: the way in is top-left (`split.tsx:224`), the drawer's close row is at the right
> (`split.tsx:257`), and while the drawer is open the bar button is already an X (`split.tsx:235`).
> Two X's, two corners. Cut one.
>
> **J10 — approve with changes.** "hide" is the wrong word; that menu says Forget
> (`workspaces-screen.tsx:162`). The route is not addressed: `use-platform.ts:93` and `:136` own
> `/workspaces`, `:715` pushes it. Losing the URL means those change, and a saved `/workspaces`
> reload must land somewhere — say where. "the rail behind it follows" does not say whether the
> list replaces the drawer's content or stacks over it. Two left sheets is two shapes. This decides
> the mock; write it.
>
> **J11 — approve.** It is J7 plus J9. Nothing new to build. The "inside a minute" claim I cannot
> check here.
>
> **Rules — approve with changes.** The 44px rule as written is global: `icon-sm` is 32px
> (`button.tsx:32`) and sits in rows, dialogs and the composer. The frame named three surfaces —
> write those three, `max-sm` only. "a focused field is never behind it" pulls in the rename dialog
> and the new-workspace input, which is 14px on a phone (`input.tsx:15`) and so zooms
> (`input.tsx:11`). Cut it back to the composer. Rule 3 must say what the Android back gesture does
> with a layer open; today back closes `/workspaces` only because it is a URL.
>
> keep: folded composer; console opens with the rail shut (`use-platform.ts:339`); left slide; 16px
> draft. cut: the global 44px rule; the general "focused field" clause; one of the two close
> controls. confused-by: two X's in two corners; layer stacked on drawer or replacing it; a 28px
> zone under a 44px rule; "hide" vs Forget. would I keep using this: yes — but two X's and a back
> gesture that closes the app are what would send me back to the terminal.

## DELEGATOR

> **DELEGATOR — run 2, J7–J11.** No browser here. I read the code. I cannot say how the keyboard
> really moves the card on a phone, or how two sheets stack in practice; the rest is from source.
>
> **J7 — approve with changes.** The "one behaviour in one place" rule has no home.
> `ui/index.html:5` has no `interactive-widget`, `globals.css:238` is `height: 100%`, and nothing in
> the plan names who reads the visual viewport. Name the hook and file, or it becomes a per-screen
> fix again. Second: the ladder skips the composer's own buttons. Send and attach are `size="icon"`
> = 36px (`composer.tsx:314`, `:271`). This is the one-thumb journey; a 36px send breaks your own
> 44px rule.
>
> **J8 — approve with changes.** The file still calls the handle open, but the owner picked B.
> Update it, and write the hit zone: the pill is 40×4 (`/tmp/handle-sketch/index.html:81-86`). A
> 40×4 drag target is not a target. Make the band full card width and ≥44px tall; the pill is only
> the mark. Say the gesture starts on that band only — a downward drag just above the card is the
> transcript's scroll today.
>
> **J9 — approve with changes.** "The way out is the same corner the way in was" is false in the
> code: in is the top-bar left button (`split.tsx:239`), the drawer's close sits top-right
> (`justify-end`, `split.tsx:188`, `:257`). Pick one close. I would cut the drawer's own close row:
> the bar's X already sits above the drawer (`split.tsx:250`, `top-12`), and that row costs 44px of
> phone height before the first run row. That height is my check-in.
>
> **J10 — reject as written.** Step one happens inside an open drawer, so the layer stacks on a
> layer. The journey never says what the drawer under it does, and "one X returns to it" is true
> only on the open-a-workspace path: close the layer and you land on the drawer, then close again.
> Write it: opening the layer closes the drawer, so one X always returns to the conversation. Also,
> with no URL, what does Back do? `popstate` rebuilds the route from the URL
> (`use-platform.ts:375`), so a URL-less layer leaves Back pointing at an older conversation — the
> thread behind the layer is lost. Decide that. And rows still cannot say if a run is alive
> (`workspaces-screen.tsx:40`); do not imply J10 helps a check-in.
>
> **J11 — approve.** This is my journey. It depends on J9's single close and on the folded composer
> keeping ambient state. The reconnecting/harness-down pills live in the controls row
> (`workspace-view.tsx:655-665`); a fold that drops that row hides a dropped stream, and then a dead
> run looks alive. That is my main churn trigger.
>
> **Rules — approve with changes.** "One phone ladder" is not one ladder. Under 44px today: composer
> send/attach 36px (`composer.tsx:314`, `:271`); the row's `…` menu 24px and visible on touch
> (`conversation-row.tsx:172`, `:178`); rail foot 32px (`workspace-view.tsx:300`, `:310`);
> workspaces rows 24px (`workspaces-screen.tsx:129`, `:142`). Fix them or write the exceptions
> down. "The draft is never lost" needs the fold state outside `Composer`: it unmounts when a screen
> shows (`workspace-view.tsx:607`). The 24px X makes two icon sizes in one bar. Cut it.
>
> keep: the rail rows as they are — dot, title, tokens/cost, age (`conversation-row.tsx`). That is
> the check-in. Left slide plus the 44/20 direction is right. cut: the 24px X, the drawer's second
> close row, and J10's row actions (rename, sandbox, forget) — this pass changes how the list opens,
> not what a row does. confused-by: which X returns where with two left layers open; what Back does
> with no URL; who owns the keyboard rule. would I keep using this: yes, if one X always lands me on
> the conversation and the fold never hides run state. If either stays open, no.

## TINKERER

> No browser here: I read the code. Motion unverified; state is not.
>
> **J7 — approve with changes.** The journey never says what measures the keyboard.
> `index.html:5` has no `interactive-widget`; `visualViewport` appears nowhere in `src`. Android
> shrinks the visual viewport; iOS moves it. Name one mechanism (a hook feeding a CSS var the
> composer offsets from), or "Keyboard first" (03:74) stays a wish. Also `focusToken` focuses on a
> phone (`composer.tsx:141`, `use-platform.ts:1059`): with the card folded that pops the keyboard the
> rule forbids, or silently does nothing. Say which.
>
> **J8 — approve with changes.** B is right, but the sketch puts the zone on "the top 28px of the
> card" — under the pass's own 44px rule, and a drag starting on the first draft line fights iOS
> text selection. Make the zone the pill plus the gap, outside the card, with `touch-action: none`
> (only the desktop splitter has it, `split.tsx:325`). Also, a folded card mid-upload: `canSend` is
> false (`composer.tsx:103`) and the chips are hidden (`composer.tsx:210`) — a dead send button with
> no reason.
>
> **J9 — approve with changes.** Two mechanisms must become one: `sheet.tsx:36` (left, `inset-y-0`)
> versus the phone drawer (`split.tsx:250`: `fixed top-12`, full width, top drop). A left slide from
> `inset-y-0` covers the bar, so the bar's hamburger-to-X (`split.tsx:239`) is unreachable. The bar
> height is hard-coded twice (`split.tsx:224` `h-12`, `:250` `top-12`); if 44px targets grow the bar,
> both move together. Say which survives.
>
> **J10 — approve with changes.** Step one is missing: the button lives in the rail head, so the
> rail opens first — then the layer sits over an open sheet, two X in one corner at the same `z-50`
> (`sheet.tsx:35`). "One X returns to it" is false while the drawer is behind. Say whether opening
> the list closes the rail. URL-less: Back stops closing it (`popstate` to `fromUrl`,
> `use-platform.ts:374`) and Android's back gesture exits the console; iOS edge-swipe-back starts
> where the left slide lives. Rename focuses a 14px input (`input.tsx:11,15`) — iOS zoom. Rows are
> 24px (`workspaces-screen.tsx:129,142`). 03:66 is wrong: `workspaces-screen.tsx:83-89` already has
> a Back button.
>
> **J11 — reject.** No new state, no check, no decision; it restates J9. It never mentions the
> inspector, the reason this persona opens the console. Make it a regression line in J7/J9.
>
> **Rules.** The ladder is expressible as tokens (44/20/24 exist, `tokens.css:172,166,168`) but not
> checkable: `check-system.ts:115-148` has no size rule and scans screens, not components. Name the
> stepping component (`Button` needs a phone size) and add its classes to the probe list. "One
> shape" is not checkable while two drawer implementations live. "No URL" is checkable: a test on
> `fromUrl`. Motion is already done (`globals.css:213`).
>
> keep: the token ladder, and one slide-in/X shape. cut: J11, the invisible-zone variant (B is
> chosen), the "Today" paragraphs that restate 01-frame. confused-by: two X in one corner, Back that
> leaves instead of closes, a 4px pill whose touch zone nobody sized. would I keep using this: yes,
> if the keyboard fix names a mechanism and Back closes the layer.

## What the panel converged on

1. **One close, not two.** All three: the in is the bar's top-left button, the drawer's own close is
   top-right, and the bar button is already an X while it is open. The drawer's close row is a
   second control in a second corner.
2. **The drag zone is smaller than the rule.** 40×4 pill, 28px zone, against the pass's own 44px
   rule. The band must be ≥44px and full width; the pill is only the mark; it must sit outside the
   card's text and take `touch-action: none`.
3. **The keyboard fix has no owner.** `index.html:5` carries no `interactive-widget` and nothing in
   `ui/src` reads `visualViewport`; Android shrinks, iOS moves. One hook, one CSS var, named in the
   plan — not a per-screen fix.
4. **Two left layers, two X's, same corner, same `z-50`.** Opening the workspaces list must close
   the rail (or the journey says what it stacks over). Two drawer implementations exist and must
   become one (`sheet.tsx:36` vs `split.tsx:250`), and the bar height is hard-coded twice.
5. **Back with no URL.** `popstate` rebuilds from the URL (`use-platform.ts:374`); a URL-less layer
   leaves Back pointing at an older conversation, and Android's back gesture exits the console.
   Decide: Back closes the layer.
6. **The 44px rule as written is global and false.** Named under-44px on a phone: composer
   send/attach 36px, conversation-row menu 24px, rail foot 32px, workspaces row buttons 24px; the
   rename/new-workspace input is 14px (iOS zooms). Either the rule names the three surfaces the
   frame named (`max-sm` only) or those targets grow; and either way it needs a check, since
   `check-system.ts` has no size rule.
7. **J11 adds nothing.** TINKERER would cut it into a regression line under J7/J9.
8. **The fold must not hide run state.** The reconnecting / harness-down pills live in the
   composer's controls row; a fold that drops that row makes a dead run look alive.

## Smaller corrections carried in

- J10's row action is "Forget", not "hide" (`workspaces-screen.tsx:162`).
- The workspaces screen already has a Back button (`workspaces-screen.tsx:83-89`); 03 is wrong.
- `/workspaces` is a route in three places (`use-platform.ts:93`, `:136`, `:715`) and needs a
  landing place for a saved URL.
- `focusToken` focuses the field on a phone (`composer.tsx:141`): with the composer folded, say
  whether it pops the keyboard.
- The composer's send path does not blur (`composer.tsx:145`).
- A folded card mid-upload has `canSend` false and no chips (`composer.tsx:103`, `:210`): a dead
  send with no reason.
- J10's rows cannot say whether a run is alive (`workspaces-screen.tsx:40`); do not imply the layer
  helps a check-in.

## The gate

The owner's reaction is required before step 05. The decisions put to them: one close; the band and
its size; the rail closing when the layer opens; Back closing the layer; the reach of the 44px
rule; J11 folding into J7/J9; the fold keeping run state.

## The owner's reaction (2026-10-12)

1. **One close — settled: top left.** The bar's own button (hamburger, swapped for an X while it is
   open) is the only close; the drawer's own close row goes, which also returns 44px of phone height
   to the list.
2. **The drag band — settled.** Full card width, at least 44px tall, pill 40&times;4 as the mark only.
3. **Workspaces layer — settled: option A.** The layer carries no X of its own; the bar's top-left
   X, or Back, or opening a workspace returns to the conversation. No double X.
4. **Back closes the layer — settled.** No URL, and Back closes the layer instead of leaving the
   console.
5. **The 44px rule — settled: the wide reach.** Below `sm` every control a thumb hits is at least
   44px, the four panel-named controls included; fields print at 16px so iOS does not zoom.
6. **J11 — settled: folded into J7 and J9** as a regression line.
7. **The fold and run state — settled: the pills stay** in the folded row while a stream is down; the
   pickers are what hides.
