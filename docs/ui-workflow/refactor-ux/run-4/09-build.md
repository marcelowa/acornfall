# 09 — Build for real (run 4)

Date: 2026-10-15. Built on `refactor-ux-4-release`, on top of the gateway slice that came before the
chain (the list, the by-name read, the tag install) and the panel's forced work.

## What shipped, journey by journey

| Journey | What is in the tree |
|---|---|
| J16 — notice and open | `ReleaseMark` in the bar (tag beside the arrow where there is room, the arrow alone on a phone with the target in its accessible name, restart pending in the same spot); `/update` and `/update/<tag>` routed by the gateway and parsed by `routeFromUrl`; Settings → **Install** → **Releases** as the permanent door |
| J17 — install the page's release | The card's **Install**, the gateway's own runs dialog (**Cancel / Not now / Stop runs and install**, with the count and the workspaces named), the "Installing…" state, the follow-until-answered poll, and the reload the console already does when the build changes |
| J18 — pick a version | The picker lists the last twenty, a per-visit **Pre-release builds** switch that refetches, the running row kept visible when it is older than the window, the target's own page with its notes and the notes in between, "older than the running build" in the facts line, and a real 404 state for a tag the source does not have |
| J19 — refusals and the restart | The rolled-back block, the list's refusal sentence, `No such release`, the dev-build line, and **Restart** on the page for a pending update |
| J20 — the phone | The same page at 390px; the mark is the bare arrow |
| J21 — install-wide settings | Settings' **General** page, with an **Updates** section first: running build, auto-check, and the Releases row; `Check now` lives on the release page; the old `/settings/defaults`, `/settings/updates` and `/settings/install` addresses are gone with no redirect |

Gateway work the build needed, already committed: `GET /api/update/releases/{tag}`,
`POST /api/update/restart`, `runsActive`/`runs` in the status, `relation` on every release read,
runs stopping after the download verifies, `available` meaning *newer*, the pin gone, and notes
from the tag annotation.

## Where the build deviated from the mock

- **The target's notes come from a by-name read.** The list carries none — every GitHub release
  body is null — so the page asks for the target and for each release in between. The mock assumed
  the list could carry them.
- **"No such release" is its own block, not the state line.** Found live: a dev build plus a bad
  tag showed only "dev build". The state line is about the build; the URL's mistake is now said
  next to it.
- **`Installing <tag>` replaces "Restarting"** while the apply is in flight: the page should not
  claim a restart before the gateway says the files are swapped (R11).
- **The in-between list renders only when the target is newer** than the running build; an older
  pick shows its own notes and the facts line says so.
- **The tabs are General and Providers**, owner's call, 2026-10-15: Defaults became General, and
the updates section moved into it, so one page holds what the install runs, what a new conversation
starts from, and the theme.
- **The notes print at the markdown renderer's own step (16px)**, not the `base` the direction
  named: `.markdown` sets `--text-lg` outside the utility layer, so no call site can re-step it.
  The look panel's word was to keep the size — it is the size the transcript already reads at — so
  the direction and the "no notes" sentence were raised to match instead.

## The mocks are gone

`ui/src/mocks/release*.tsx` are deleted, per the chain's rule. The stories now render the shipped
screen: `Screens/Release`, thirteen stories — the page states, the picker with and without
pre-releases, a picked version, the phone, the mark, and the install-wide section.

## Checks

- `make check` (ui build, typecheck, worker and ui units, the gateway's short suite) green;
  `make lint` clean; `bun scripts/check-commits.mjs` clean.
- Headless chromium over the thirteen stories at **1280 and 390**: no console error, no horizontal
  overflow.
- **Live smoke against a real gateway** (a review install on the tailnet, running `v0.9.20` with a
  real token): `/api/update/status` answers runs and sizes; `/api/update/releases` answers twenty
  real releases; `/api/update/releases/v0.9.33` answers with the notes resolved from the tag
  annotation; `/update`, `/update/v0.9.28`, and `/update/v0.9.4` (outside the twenty) all render
  their cards, and `/update/v9.9.9` says no such release. Nothing scrolls sideways at 390.

## The live drill, from the new screen (2026-10-15)

The owner pressed **Install** on the review install, and it ran end to end: backup, download, verify,
stop runs (none), swap, self-restart. `/healthz` then named `v0.9.33` — the released binary took the
review binary's place on disk, and the branch build sits beside it as `acornfall-review.bak`.

Two things they saw, both explained and neither a defect:

- **The page reloaded under them.** The console reloads the window when the stream's build changes
  (that behaviour predates this run; `use-platform.ts`'s `trackBuild`). The address stayed where it
  was; nothing in the release page redirects.
- **`/update` then fell back to the conversation.** The new binary is the released v0.9.33, whose
  embedded interface predates the release page entirely, so that address names no page in the bundle
  it serves. The review install cannot show the new surface after it updates itself — that is what a
  real install does.

The review install was rebuilt from the branch with a fresh data dir afterwards, back on v0.9.20.

## The owner's report: five seconds of nothing, and what it was (2026-10-15)

The owner: *"it takes more than 5 seconds to show all the versions 'what changed in between', maybe
we need a busy/loading indicator until they show."* Both halves were right.

The cause was a read per release: each in-between entry called the by-name read, which is three
GitHub calls (the release, the tag ref, the tag object), and twelve entries meant up to thirty-six
calls behind one blank block.

What changed:

- **One read for all of them**: `GET /api/update/notes?tags=…` answers several tags at once, with a
  cache (a tag's notes never change) and eight lanes, so a cold picker open makes two calls, not
  thirty-six. A read through any other path warms the same cache.
- **The rows are the list's, and are there at once**: the in-between block renders each tag the
  moment the list arrives, each saying "Reading the notes…" until the single read answers, and "This
  release shipped no notes." when a release has none. A bug the measurement caught: the block was
  rebuilt on every render, so the notes effect looped — hundreds of calls in one page load. It is a
  memo now, keyed by the tags themselves.

Measured on the review install, 1280: the notes were visible at **6028ms** before, with dozens of
calls; **3051ms** cold and **982ms** warm after, with five and four calls. The blank wait is gone
either way: the tags and their dates are on screen within a second.

## What is left for step 10 and 11

- The owners' panel on the shipped look, and the owner's own notes.
- `make ui` (the browser suite) against the review install — it needs the console running, which it
  now is.
- The restart control's live drill (apply, then Restart) is the owner's to run, like the earlier
  update drills: the review install should not be swapped from under the review.
