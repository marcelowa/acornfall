# 08 — Framework doctor

Date: 2026-08-29. Run over the consolidated `ui/` before step 09 builds on it.

## What ran, and what it said

| Check | Result |
|---|---|
| `bun run check:system` | tokens resolve, defaults do not, screens carry no classes |
| `bun run lint` (oxlint) | 0 warnings, 0 errors, 171 files |
| `bun run typecheck` (tsc, strictest) | clean |
| `bun run format:check` (oxfmt) | all files formatted |
| `bun test` | 77 pass, 0 fail |
| `bun run build:storybook` | completed |
| `make lint` (root: gofmt, go vet, staticcheck, house rules, worker lint, interface lint, check-system, format) | clean |

This repo has no React-doctor equivalent; its own policies are the health check, and they pass.

## What it flagged

**Story coverage — one real gap.** `components/transcript/user-message.tsx` had no story, which
means the transcript's own reading surface was the one thing a reviewer could not look at: your
words exactly as typed, a message that can be branched from, and another conversation's words
(asked or reported, with the model-facing prefix hidden). Added `Conversation/UserMessage` with
four stories — OwnWords, Branchable, PeerReport, PeerAsk.

The rest of the list, and why each is covered:

- `pane-footer`, `thinking-dots`, `fact`, `notice-line`, `brand-mark` — atoms with no state of
  their own, shown inside their parents' stories.
- `pane-card` and `settings-group` — the shells extracted in step 07; their stories are the three
  cards and the settings pages that use them.
- `update-section` — storied through the screen: `Screens/Settings` has `Updates` and
  `UpdatesApplying`, plus the failure state in the release card.
- `typography` atoms — `Foundations/Typography` is the scale.
- `ui/sheet` — the rail's drawer below `lg`, shown by the workspace-view stories.

## The two things no tool here sees

- **Story coverage**, above: every state a screen can be in has a story, except the peer/report
  forms of a user message, which now do.
- **Accessibility basics.** Verified by reading, not by running: the reduced-motion guard is
  global (`globals.css:198`), and `focus-visible` rings are present on every interactive surface
  (button, input, textarea, tabs, toggle group, the rail row's select, the splitter, the inspector
  sections). The a11y addon is configured in Storybook, so every story reports its own violations
  in the owner's run; `make ui` covers the keyboard paths in a real browser. **Neither could be
  run in this sandbox** — no browser, no gateway — so this is the one part of the doctor step that
  is the owner's to close, and it is named here rather than implied.

## Out of scope, with reasons

- `make ui` (the browser suite) — no browser in this sandbox.
- The four panel claims that need a live console: the rail keeping the old list during a switch,
  the inspector showing only the latest request, no Escape handler in settings, and the image
  field's exact commit path. They stay on the step 09 list.
