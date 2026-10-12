# 01 — Frame the session

Date: 2026-10-12 (chain run 2, branch to be named `refactor-ux-2-mobile`)

## The frame, as stated back to the owner

This is chain run 2, on top of run 1's shipped direction (`design.md`, `icp.md`, and the record in
`../`). The console already has tokens, journeys and persona checks; this pass does not re-open
them. It is scoped to the phone, and inside the phone to three surfaces the owner named: the
composer with the keyboard up, the top bar and its icons, and the navigation — the rail drawer and
the workspaces list — which today drops from the top instead of sliding from the side.

So the pass is gated the same way as run 1, but the decision under review is narrower: phone
behaviour and the phone step of the size ladder. Desktop keeps its direction unless a change has
to land in a shared component.

The operator is still one person, the owner. Run 1's foundation clause still holds.

## The 12-step todo list

- [x] 01 Frame the session — frame confirmed, questions answered below
- [x] 02 Confirm the goal — phone clause accepted; the workspaces layer loses its URL
- [x] 03 Draft the desired journeys — reviewed; handle option B chosen
- [x] 04 Panel on the journeys — all seven calls answered by the owner
- [x] 05 Pick the colour scheme (run 2: the phone ladder) — confirmed by the owner
- [x] 06 Mock and iterate — approved by the owner
- [x] 07 Consolidate — one layer, one close, one bar height, the phone step in the ladder
- [x] 08 Framework doctor — checks green; the phone step is now probed
- [x] 09 Build for real — all four journeys in the app; the mocks are deleted
- [x] 10 Panel on the look — round 2 delivered; its findings fixed; four items await the owner
- [~] 11 The owner's final pass
- [ ] 12 Finalize the docs

## The owner's named pains (input to step 03)

1. Focusing the composer on a phone opens the keyboard, but the composer hides below it.
2. Consider a folded composer on a phone until focus.
3. A swipe down from the composer's top border should unfocus the composer.
4. The top menu and its icons should probably be bigger.
5. The navigation:
   - 5.1 the drawer should slide open from left to right, and close from right to left;
   - 5.2 the icon that closes it should be an X;
   - 5.3 the workspace and the workspaces list should behave the same way — opened with a
     button, closed with an X — and the current icon/experience for opening the workspaces list
     is not ideal;
   - 5.4 the icons should be larger.

## Where this bites in the code (first read, not a decision)

- Composer: `ui/src/components/composer/composer.tsx`, placed by `app/workspace-view.tsx` at the
  bottom of the `Split` column. The page is `h-full` inside `#root`; nothing yet listens to the
  visual viewport, so the keyboard shrinks the layout viewport and the card goes under it.
- Top bar: `ui/src/components/layout/split.tsx`, `h-12` with `icon-sm` ghost buttons; the drawer's
  own close row uses `PanelLeftClose`.
- Drawer: the same file, below `lg`, drops from under the bar
  (`slide-in-from-top`, full width, no overlay edge on the left).
- Workspaces: reached from the rail head's `ChevronsUpDown` button, which swaps the whole screen
  (`platform.showScreen("workspaces")`); `WorkspacesScreen` then has no close of its own.

## Open questions put to the owner

1. "Right sidebar": confirm it means today's phone drawer (the rail, which drops from the top),
   so the target is a left-edge slide in and out, plus an X close.
2. Workspaces list: full screen with its own button and X, or a layer over/beside the rail?
3. Folded composer: one row with the placeholder and send, or with the pickers kept? Does it fold
   back after sending?
4. Swipe-down: is there a visible handle on the top border to drag, and does unfocus also fold the
   composer?
5. Size ladder: phone-only, and how far (proposal: 44px targets with 20px icons in the bar, the
   drawer close and the rail head; 24px X)?

## The owner's answers (step 01 exit gate)

1. "Right sidebar" is today's phone drawer, the rail: slide in from the left, out to the left, X to
   close. Confirmed.
2. The workspaces list stops being a destination: no new page, no URL change, it opens as a layer
   (same shape as the drawer) with a button to open and an X to close.
3. The folded composer: mock and look at it before deciding. Both variants go into the step 06
   mocks — placeholder + send only, and one with the pickers kept.
4. Swipe down unfocuses **and** folds. Whether a visible drag handle sits on the composer's top
   border is a step 06 question, mocked both ways (handle, and invisible zone) for the owner to
   pick.
5. Sizes: try the proposal — phone-only, 44px targets with 20px icons in the top bar, the drawer
   close and the rail head; 24px X. Desktop keeps run 1's ladder; a shared component steps up
   below `sm` only.

## Decisions taken while framing

- Run notes: `docs/ui-workflow/refactor-ux/run-2/`, one file per step; run 1's files stay as they
  are, and `README.md` gains a "Run 2" section at step 12.
- Mocks stay Storybook stories (owner's choice in run 1, ADR-0016).
- No browser in this sandbox: `bun run build:storybook` and the checks run here; the owner reviews
  the mock and the shipped look on their own phone.
