# 01 — Frame the session

Date: 2026-10-13 (chain run 3, branch `refactor-ux-3-providers`)

## The frame, as stated back to the owner

This is chain run 3, on top of run 1's direction (`design.md`, `icp.md` and the record in `../`)
and run 2's phone pass (`run-2/`). The console has tokens with teeth, journeys, persona checks and
a Storybook catalogue; this pass does not re-open any of them.

It is scoped to one surface the owner just shipped and named: **settings → Providers**, the list
and the connect dialog. The named defect is concrete — a sign-in address is long enough to pull
the dialog sideways — but the request is "some improvements", so the pass starts where the chain
always starts: the journeys through this surface, the personas' read of them, and only then
pixels. Nothing here is a new capability; the run is about a surface that already works.

The operator is still one person, the owner. Run 1's foundation clause still holds.

## The 12-step todo list

- [x] 01 Frame the session — frame confirmed; the answers are below
- [x] 02 Confirm the goal — `02-goal.md`; the owner's rule: gates are answered by looking
- [x] 03 Draft the desired journeys — J12–J15 and R1–R5, in `03-journeys.md`
- [~] 04 Panel on the journeys — three reviewers against the running console (in flight)
- [x] 05 Pick the surface's direction — `05-palette.md`: long values, copy, the list, the states
- [~] 06 Mock and iterate — `06-mocks.md`: seven stories in the catalogue, awaiting the owner
- [ ] 07 Consolidate — one implementation per pattern
- [ ] 08 Framework doctor — checks green, or what they flag is fixed
- [ ] 09 Build for real — every journey matches its mock
- [ ] 10 Panel on the look — **gate**
- [ ] 11 The owner's final pass
- [ ] 12 Finalize the docs — `design.md` and `icp.md`, and the README's run list

## The owner's named pain (input to step 03)

1. "The UI of the providers needs some improvements; the link is very long and creates
   scrollbars."

## Reproduced here (first read, not a decision)

At a 1200×800 viewport, opening OpenRouter's sign-in:

- the dialog is 446px wide, and its content is **1465px**: a 1019px horizontal overflow, which is
  the scrollbar the owner saw;
- the address row measures 1417px and never shrinks, and the truncation inside `ClippedText`
  cannot help because the box it truncates has already been widened;
- the cause is the usual one: a `grid`/`flex` chain where the items keep their default
  `min-width: auto`, so the column grows to the URL's min-content width. The row is the `Address`
  block in `provider-login-dialog.tsx`, and the same thing is reachable through the provider's
  own `progress` line (an unbroken worker address in a `<Text>`), and any `info` link.

## Where this bites (first read, not a decision)

- `ui/src/components/settings/provider-login-dialog.tsx` — `Address`, the `Notice` blocks, the
  `Stack`s around them, and the dialog's own scroll container.
- `ui/src/components/settings/providers-section.tsx` — the list this dialog opens from.
- The measurements above are window-width independent: the row asks for the URL's full width
  wherever it is.

## Open questions put to the owner

1. **Scope**: the connect dialog only, or the whole providers surface — the list, the rows'
   actions, the search, the disconnect confirmation, the re-check — for the journey pass?
2. **Other pains**: what else about providers should this pass fix? The named one is the scrollbar;
   the run is the place to collect the rest.
3. **The address itself**, for the step 06 mocks: one clipped line with Copy and Open (today's
   shape, made to shrink), a short label with the address behind a copy or a details toggle, or
   wrapping the address over two lines? Each keeps the headless paste field; the question is what
   the address looks like on a desktop and on a phone.
4. **Phone**: should the fix hold at phone width too (no sideways scroll, and the address still
   copyable)?
5. Run notes stay `docs/ui-workflow/refactor-ux/run-3/`, one file per step, as in run 2.

## The owner's answers (step 01 exit gate)

1. **Scope**: not the dialog alone — the providers surface in general, and both **mobile and
   desktop**. So the list, the rows and their actions, the search and the connect dialog are all
   in scope for the journey pass.
2. **Other pains**: none named beyond the scrollbar; "general" is the instruction — improve the
   surface, not one control.
3. **The address**: **copy buttons wherever they make sense** is the direction they like. The
   step 06 mocks take that as the lead: what gets a copy button, what gets opened, what is shown
   as a label, at both widths.
4. **Phone**: the fix holds there too — no sideways scroll, and the address stays copyable.
5. Run notes stay in `run-3/`, one file per step.
