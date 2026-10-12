# 06 — Mocks, round 1

Status: **shown to the owner, awaiting the round's reaction.** Nothing here is wired to the
platform, and the folder (`ui/src/mocks/`) is deleted in step 09 once each direction is real.

## How to look

The dev catalogue is already running in this sandbox on port 6006, so the owner can open it from
their own machine or phone:

- http://100.112.224.8:6006
- http://acornfall-dev.tailed76ef.ts.net:6006

The group is **Mocks** in the sidebar, below Screens. Every story is pinned to the Phone (390)
viewport; the toolbar's theme switch gives light and dark. `bun run storybook` on the host works
too, and `bun run build:storybook` is the headless check.

## What was built

| Story | What it argues for | Journey |
|---|---|---|
| `Mocks/Phone — navigation` / **Bar — nothing open** | The bar at the phone step: 56px, one 44px button at the left with a 20px icon, brand and title beside it | J9 |
| `Mocks/Phone — navigation` / **Drawer — open from the left** | The rail arrives as a layer below the bar, full width, slid from the left. No close of its own: the bar's button is the X. The workspace's own name is the button that opens its list; the rail foot's two buttons are 44px | J9, J10 |
| `Mocks/Phone — navigation` / **Workspaces — the layer, no X of its own** | The workspaces list over the conversation, same left slide, no X inside it; rows with 44px `Open` and 44px menu | J10 |
| `Mocks/Phone — composer` / **Folded — at rest** | The folded row: pill on the top border, the draft's words or "Message", a 44px send. Nothing pops the keyboard | J7 |
| `Mocks/Phone — composer` / **Folded — with a draft and something to say** | A reconnecting pill and an upload count stay in the folded row, so a fold never hides a dropped stream and a dead send has a reason | J7, panel 7 |
| `Mocks/Phone — composer` / **Open — the band** | The approved handle (option B): 40×4 pill in a 44px band, full card width, drawn dashed so the target is visible | J8 |
| `Mocks/Phone — composer` / **Open — above the keyboard** | The same card with the keyboard drawn beneath it and the inset named, which is the whole point of J7 | J7 |
| `Mocks/Phone — composer` / **Open — pickers, send, attach** | The state a tap leads to, unannotated | J7 |
| `Mocks/Phone — composer` / **Open — a run is live** | Stop / Steer / Queue at the phone step | J7 |
| `Mocks/Phone — targets` / **Today against 44px** | Every control the wide rule covers, today's size beside the new one, with the rendered heights printed under each: bar button 32→44, send and attach 36→44, row menu 24→44, rail foot 32→44, workspaces `Open` 24→44, fields 15→16px | step 05 §1 |

## Honesty notes

- Token classes over the real primitives (`Button`, `Input`, `Badge`, `Rail`, `ConversationList`,
  `ClippedText`, `Text`, `ChoiceControl` and `Composer` itself). Nothing invents a class, and
  nothing invents data the gateway does not produce.
- The folded row and the layers are mock-only: `Composer` has no folded state yet, and `Split`'s
  drawer still drops from the top. Step 09 makes both real.
- The keyboard is drawn, not simulated. The claim the mock makes is the layout claim: the card sits
  above the keyboard and reads one variable for it.
- No browser here, so the stories were checked by compiling them and by rendering all ten with
  `react-dom/server` in this sandbox (each produced markup; nothing threw). Looking at them is the
  owner's step.
- Checks after the mocks: `typecheck`, `lint`, `check:system`, `format:check`, `bun test` (86 pass)
  and `bun run build:storybook` — all green.

## Round 1 — what to react to

1. The bar: 56px tall, one 44px button, 20px icons. Right size, or still small?
2. The drawer: no close of its own, the bar's X as the only one, the workspace name as the button.
3. The workspaces layer: no X, the same left slide, rows at 44px.
4. The folded row: pill, draft's words, 44px send. Does the folded row say enough about what it is?
5. The band: 44px, full card width, pill as the mark. In the right place?
6. The keyboard story: does the claim (card above the keyboard, one variable) read as right?
7. The targets table: anything that should not grow, or anything missing from it?
