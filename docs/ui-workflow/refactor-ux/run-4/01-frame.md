# 01 — Frame the session

Date: 2026-10-15 (chain run 4, branch `refactor-ux-4-release`, based on `feat-release-picker`)

## The frame, as stated back to the owner

This is chain run 4, on top of run 1's direction (`design.md`, `icp.md`, the record in `../`), run
2's phone pass (`run-2/`) and run 3's providers pass (`run-3/`, paused at its step 06 while its
mocks wait for the owner's look).

It is scoped to **the release surface**: the update screen, the new-version indicator, and the
picking of a release to install. Today that surface is one Settings tab — `settings/updates` —
plus a top-bar dot that carries a count of `1`, and it can only install the release the last
check found. The gateway now lists the last twenty releases and installs a chosen tag (commit
`80442c5` on `feat-release-picker`), so part of what the owner asked for has no interface yet,
and the rest is a surface that works but was never taken through the chain.

Nothing here re-opens the tokens (ADR-0016), the journeys already drafted, or the Storybook
catalogue: they are the ground this pass stands on. The operator is still one person, the owner;
run 1's foundation clause holds — multi-user gets a foundation, not features.

## The 12-step todo list

- [x] 01 Frame the session — this file; the frame awaits the owner's confirmation
- [ ] 02 Confirm the goal — the console's goal, plus what the release surface is for
- [ ] 03 Draft the desired journeys — J16+ through the release surface
- [ ] 04 Panel on the journeys — **gate**: raw feedback, owner reacts
- [ ] 05 Pick the surface's direction — `05-palette.md`
- [ ] 06 Mock and iterate — **gate**: the owner approves the mocked direction
- [ ] 07 Consolidate — one implementation per pattern
- [ ] 08 Framework doctor — checks green, or what they flag is fixed
- [ ] 09 Build for real — every journey matches its mock
- [ ] 10 Panel on the look — **gate**: every persona approves the shipped look
- [ ] 11 The owner's final pass
- [ ] 12 Finalize the docs — `design.md`, `icp.md`, and the README's run list

## The owner's named pains (input to step 03)

1. "I want us to improve the release ui."
2. The update screen should be a top-level screen with its own URL, showing the changes of the
   release and allowing the install.
3. The new-version indicator should show the last GA version released, and follow a new GA when
   one lands.
4. Settings should let someone pick from the last releases, with a flag for the other kinds
   (`-rc`, `-testing`, `-pre`); the pick navigates to the update screen for that release, with
   its changes and the install.
5. "1 in the indicator is weird" — a count is not how other apps say a newer version exists.
6. "Something that fits this app, and it should consider mobile and desktop."

## Decided before the run (the gap review; the API half is recorded in ADR 0019)

- The screen is top level, with its own URL, per-version URLs included.
- The picker lists the last 20 releases, newest first by version.
- Pre-releases hide behind a switch that resets each visit — not a stored channel.
- A pick installs that tag once. It does not pin; the pin stays its own field.
- The indicator names the newest GA beside the dot on a desktop, and is a bare dot on a phone.
- The notes of every release between the running build and the target show, while they fit the
  20-release window.
- Downgrades stay unguarded for now: an older release is marked as older and stays installable
  until the migration record exists.

## Reproduced here (first read, not a decision)

- `ui/src/components/settings/update-section.tsx` — the screen as one card: a `View notes`
  toggle, the VM keep/clean choice, the backup note, then the prefs. It renders inside the
  Updates tab and knows no URL of its own.
- `ui/src/app/workspace-view.tsx:573` — the indicator: an `ArrowUp` button with a badge reading
  `1`, present only while `available`, and it jumps to the Updates tab.
- `ui/src/app/use-platform.ts:99` — the routes: `/settings/<tab>` and nothing for a release
  screen. `settingsTab` is part of the route state.
- `ui/src/app/client.ts:322` — `UpdateStatus`; no call answers a release list yet, so the screen
  has never seen a version other than `latest`.
- `ui/src/components/settings/settings-screen.tsx` — the tab bar this pass may empty out if
  Updates moves to a page of its own.

## Open questions put to the owner

1. **The old page.** Does Settings → Updates keep the prefs (auto-check, pinned tag) and link to
   the screen, or do the prefs move onto the screen and the tab goes?
2. **The picker's home.** You said "settings allows you to select" and "once you select it
   navigates you to the update/install screen". Is the list itself on the screen, and the
   settings tab's job just to get you there — or does the list live in Settings, with the screen
   showing only the chosen release?
3. **The indicator**, when it is a bare dot on a phone: does it still open the screen on press,
   and does it disappear on any screen, or stay everywhere as the top bar does today?
4. **The screen's entry points**: indicator, a URL someone pastes, and Settings — anything else
   (a rail row, a link after a failed update)?
5. **Old links**: `/settings/updates` should keep working, as a redirect to the release screen.
6. **Notes rendering**: the release notes are the tag message, markdown by convention. Render
   them as markdown, or keep them as plain text lines?

## The owner's answers (step 01 exit gate)

The frame was confirmed, 2026-10-15, with these answers:

1. **The old page.** Settings keeps the prefs, and the Updates tab may go: the prefs belong to the
   install, so they move to the global side of settings — the exact page is step 03's to name.
2. **The picker's home.** On the screen itself. Settings is only a way in.
3. **The indicator on a phone.** A bare dot still opens the screen on press, and it stays on every
   screen, as the top bar does today.
4. **Entry points.** Indicator, a pasted URL, Settings — as listed, nothing else.
5. **Old links.** No redirect: `/settings/updates` is removed.
6. **Notes.** Rendering is ours to recommend. The console already renders markdown for the
   transcript (`ui/src/components/transcript/markdown.tsx`), so the recommendation is to render
   release notes with that component rather than a second parser.

One question carried into step 03: with the Updates tab removed, which settings page holds
`auto-check` and the pinned tag — a page on the install's global side (a new one, or an existing
one that fits) — and does the pin keep its place now that a pick never sets it.
