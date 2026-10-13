# 06 — Mocks, round 1 (run 3)

Status: **shown to the owner, awaiting the round's reaction.** The list stories are mock-only
(`ui/src/mocks/`, deleted in the build step); the dialog stories render the product, because the
long-value fix is mechanical and already in the primitive.

## How to look

Both are live in this sandbox, reachable from the owner's own machines and phone:

- **The catalogue**: http://100.112.224.8:6006 · http://acornfall-dev.tailed76ef.ts.net:6006 —
  group **Mocks/Providers**, below Screens. The phone stories are pinned to Phone (390); the
  toolbar's theme switch gives light and dark.
- **The console itself**: http://100.112.224.8:7777/settings/providers — the fixed build, the real
  42-provider catalogue, a dev model so conversations work. The dialog there is the product, not a
  drawing; OpenRouter's Sign in is the fastest way to see a long address.

`bun run storybook` on the host works too, and `bun run build:storybook` is the headless check.

## What was built

| Story | What it argues for | Journey |
|---|---|---|
| **List — the reading** (desktop) | Two named groups with counts, so "what can this install use" is answered before a scroll; Re-check beside the search; the state line clips and shows itself whole on hover, focus or tap | J12, R1 |
| **List — the reading** (phone) | The same reading at 390px: groups first, search and Re-check on one row, rows at 44px, nothing sideways | J12, R5 |
| **Address — desktop** | The real dialog with a real 246-character OpenRouter address: one clipped line, Copy beside it, Open after it, the dialog still 446px | J14, R1, R2 |
| **Address — phone** | The same at 390px: the address clips, Copy address and Open wrap under it at the 44px step, the paste field stays | J14, R5 |
| **Device code** (phone) | A device code and its address, both copyable, nothing to hunt | J14, R2 |
| **Refusal — a long message** | The provider's own 214-character refusal wraps inside the dialog; the dialog does not move; Try again is named | J13, J15, R1, R3 |
| **Today against the rule** | The defect and the fix side by side: a box that scrolls sideways because its item kept `min-width: auto`, and a box that clips instead | R1 |

## The numbers (measured in this sandbox)

- OpenRouter's sign-in at a 1200×800 viewport: before, the dialog's content was **1465px inside a
  446px dialog** (1019px of sideways overflow, with the header and footer stretched to 1417px);
  after the primitive's fix, **446px and 446px**, and the address clips at 250px with the whole of
  it one gesture away.
- The comparison story's two boxes: before **502/326** (176px of overflow), after **326/326**.
- The list at 390px: the page is **390/390** (nothing sideways), 42 rows, groups
  **Connected (3)** / **Not connected (39)**, and Vertex's 57-character source clips from 532px to
  238px.
- Every dialog story renders at **446/446**; all seven stories render with no console error.

## What is real, and what is a mock

- **Real, already in the product**: the dialog primitive lets every child shrink
  (`[&>*]:min-w-0`); prose that can carry a value wraps anywhere; the address row clips with Copy
  and Open; the device code, the refusal and the status line all fit the dialog.
- **Mock-only**: the two named groups, Re-check beside the search, and the state line as clipped
  text. The build step makes them real.
- **The data** is the real catalogue this sandbox's worker reports (42 providers, ids, names and
  methods), with three rows marked connected for the mock — the sandbox had none — using the real
  shapes of a saved key, a sign-in, and a Vertex ADC path.

## Checks

`typecheck`, `lint`, `check:system`, `format:check`, `bun test` (107 pass), `bun run
build:storybook`, and a headless pass over all seven stories (rendered, no errors, dialogs
measured). `tools/check-ui.mjs` against the fixed console: 100 checks pass.

## Round 1 — what to react to

1. The list's groups and counts: right labels, right order? (Connected first is today's order.)
2. Re-check beside the search — and the hint under it kept or cut?
3. The state line clipping with the whole of it on tap: does that read on a phone?
4. The address row: one clipped line with Copy and Open, or would you rather see two lines?
5. The copy set: address and code only. Anything else that should copy (the key field? the
   provider's source?), or anything that should not?
6. Anything on the real console that still scrolls sideways at either width — that is the defect
   this round exists to close.
