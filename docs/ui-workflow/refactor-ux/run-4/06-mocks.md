# 06 — Mocks, round 1 (run 4)

Status: **shown to the owner, awaiting the round's reaction.** The mocks are `Mocks/Release` in the
catalogue, under `ui/src/mocks/` (deleted in the build step). The pages and the picker are mock
compositions; every control and card they use is the product's own.

## How to look

- **The catalogue**: http://100.112.224.8:6006 · http://acornfall-dev.tailed76ef.ts.net:6006 —
  group **Mocks/Release**, below Screens. The toolbar switches light and dark; the phone stories
  are pinned to Phone (390).
- The console itself is not part of this round: none of this exists in the product yet, so the
  catalogue is the review surface.

## What was built

| Story | What it argues for | Journey |
|---|---|---|
| **The page — newer release** | Running → offered → changed → cost → the press. The state line, the notes in prose, the in-between list, the size and backup facts, the VM choice kept, Install last, the picker below | J16, J17, J18 |
| **The page — pre-releases** | The switch widens and refetches: `v0.9.34-rc.1` above the GAs, marked `pre` in muted mono — a fact, not a coloured alarm; off on every fresh open | J18 |
| **The page — up to date** | No prompt, and still a place to pick a version; the cut line names what the twenty hold | J16, J21 |
| **The page — a version picked** | An older release says "older than the running build" in its facts line, with its own notes and the notes it rolls back over; picking installs nothing and pins nothing | J18 |
| **The page — restart pending** | The state that needs the owner, as a sentence with **Restart**, on the page and in the bar's own spot | J17, J19 |
| **The page — rolled back** | The gateway's cause, the failed tag, the running build, and both ways out | J17, J19 |
| **The page — source refused** | Which refusal it is, in the gateway's words, with the last known release still named | J19 |
| **The page — dev build** | A build with no release tag names itself and claims nothing; the picker still works | J16 |
| **The bar** | One mark, two widths: tag beside the arrow on a desktop, arrow alone on a phone (target in its label), restart pending in the same place | J16, J20, R12 |
| **The runs dialog** | The gateway's own count — every started workspace — with the workspaces named and three choices that each say what they do | J17 |
| **The phone** | The page at 390px: one column, nothing sideways, Install in reach, 44px rows | J20 |
| **The install-wide settings page** | The running build and auto-check live here, and **Releases** is the permanent door — the only in-app one when nothing newer is known | J21 |
| **Today, for contrast** | The product as it is on this branch: one card, a `1` on the bar, the notes behind a toggle, the pin field in the same card | — |

## The finding this round turned up

**Every GitHub release body is null.** `GET /releases` answers `"body": null` for all twenty
releases, so `status.notes` is empty today and the current screen's "View notes" button never
appears. The release notes exist only as **tag annotations** (`git tag -a`), which is where the mock
reads them from. Build item: the gateway reads the tag annotation
(`GET /git/ref/tags/{tag}` → `GET /git/tags/{sha}` → the message) and/or the release workflow fills
the release body from now on. Recommendation: both — the workflow fix for the GitHub page, the
annotation read so every release so far has notes.

## The headless pass

Chromium is present in this sandbox after all. All 13 stories at **1280 and 390**: no console error
and **no horizontal overflow** (the only 404 is Storybook's own `favicon.ico`). `typecheck`, `lint`,
`check:system`, `format:check` and `build:storybook` are clean.

## What is real, and what is a mock

- **Real**: `Measure`, `Stack`, `Text`, `Badge`, `Button`, `Toggle`, `ToggleGroup`, `Dialog`,
  `SettingsGroup`, and the transcript's own markdown renderer for the notes. The data — tags, dates,
  asset sizes, notes — is this repository's releases.
- **Mock-only**: the page composition, the picker rows, the bar's mark, the settings row, and the
  RC release that shows the switch working.

## Round 1 — what to react to

1. **The page order**: running → offered → changed → cost → Install last. Does that match your first
   read of what a release page is?
2. **The notes**: prose at `base`, tags in mono, and the "what changed since vX" list of everything
   in between. Useful in that shape, or should the in-between entries fold to one line each?
3. **The bar**: tag beside the arrow on a desktop, arrow alone on a phone, restart pending in the
   same spot. Too quiet, or right?
4. **The picker**: rows as links, the running build marked, `pre` muted, the cut line named. What is
   missing from a row?
5. **The states**: read the seven state stories. Any sentence wrong, or a state you would hit that
   is not here?
6. **The settings page**: running build, auto-check, and the Releases row as the door. Is that the
   door you want?
7. **The runs dialog**: "5 runs are active across acornfall and hello-omri", with **Not now** and
   **Stop runs and install**. Enough to decide, every time?
