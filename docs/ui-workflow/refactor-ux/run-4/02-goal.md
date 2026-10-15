# 02 — Confirm the goal (run 4)

Status: **proposed to the owner, 2026-10-15** — awaiting their correction. Run 1's goal
(2026-08-29), run 2's phone clause (2026-10-12) and run 3's providers clause (2026-10-13, paused at
its step 06) stand; run 4 adds one surface, so the statement below is those plus the release clause,
which is the part open to correction.

## The goal statement, as a claim

Acornfall is a local-first agent console for one technical operator. A Go gateway supervises a bun
worker and a microVM sandbox per workspace, and `ui/` is the only face of it. Working well, from run
1: find the right conversation in a rail of dozens, read a tool-heavy turn without losing the place,
intervene mid-run with no doubt about the control, change a setting once and know it stuck, and see
what the model saw and what it cost. Working well on a phone, from run 2: one thumb, the keyboard
never covering the composer, one shape for the navigation, and nothing under 44px. Working well
through providers, from run 3: the state readable down the list, nothing long widening anything, and
a connect flow that says what it waits for.

Run 4 says the release surface is how this install stays current **without a terminal**. Today an
update is one card in a settings tab, a dot with a `1` on it, and one release it can install —
`latest`, whatever the last check found. The gateway behind it can now list the last twenty releases
and install any one of them (commit `80442c5`); the interface has never shown that. Working well on
this surface means:

- the owner can tell, from the desk or the phone, that a newer **production** release exists, and
  which one it is — a dot alone cannot say a version, and a count of `1` says nothing at all;
- one page with one URL says what the running build is, what the target is, what changed between
  them, what the download costs, what is backed up, and what pressing Install does — and the press
  does it, with the restart that follows said out loud;
- when a specific release is wanted — newer, or older than the running build — it is findable in the
  last twenty, newest first, with the non-production builds (`-rc`, `-testing`, `-pre`) behind a
  switch that widens the list **for that visit** and is never a stored channel;
- picking is not pinning: a pick installs once, a pin still means "stop asking", and the screen says
  which state the install is in;
- a failed update says what failed and which tag it was, and the way back — rollback — is on the
  same page rather than in a document;
- the page is honest when the source cannot answer: a missing token, no network, an empty list each
  get a sentence, not an empty picker.

Success: the owner goes from "a new release exists" to "the new release is running" from the
console — desk or phone — without opening a terminal, and can say what changed on the way.

Failure: updating still means a terminal, or the surface names a version that is not the one
running, or picking a release quietly stops future prompts.

The measurement stays run 1's, with one line added: does the owner still reach for the console — and
how long does it take to move this install to the release they chose.

## The foundation clause

One operator today; the interface must later carry a multi-user platform without a rewrite. Run 4
adds two lines to the foundation: the release state has exactly one source — the gateway's update
tier, never a second copy derived in a component — and the surface's pieces (the indicator, a
release row, the notes block, the install action) take their state and their callbacks as props, so a
later hosted or multi-user install reuses them instead of forking them.

## What "working well" does not mean in run 4

- Not new capabilities beyond the picker the gateway already has: no auto-install, no delta
  downloads, no tree-build channel, no per-release rollback history, and no migration record — that
  one is deferred, with the downgrade guard it would carry (ADR 0019).
- Not a new palette and not a new type ladder: run 1's roles and run 2's phone step stand. Sizes and
  states this surface needs join the existing ladders.
- Not a change to the check rules: the hourly check and the auto-check pref are the gateway's, and
  the surface reads them.
- Not a second markdown pipeline: release notes render with the transcript's renderer
  (`ui/src/components/transcript/markdown.tsx`), recommended and taken as the owner's answer to
  step 01's question 6.
- Not a redesign of the top bar: the indicator takes the shape the owner chose — the newest GA's tag
  beside the dot on a desktop, a bare dot on a phone, the same press on both.

## The one question this step carries

With the Updates tab removed, which settings page holds `auto-check` and the pinned tag? Steps 03
and 05 decide it; the goal only says the prefs stay in settings and remain reachable without the
old tab's URL.

## Confirmation

_(to be filled when the owner stops correcting)_
