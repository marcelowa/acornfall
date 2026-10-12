# 08 — Framework doctor

Date: 2026-10-12. Run over the consolidated `ui/`, before step 09 builds on it.

## What ran, and what it said

| Check | Result |
|---|---|
| `bun run check:system` | tokens resolve, defaults do not, screens carry no classes |
| `bun run lint` (oxlint) | 0 warnings, 0 errors, 175 files |
| `bun run typecheck` (tsc, strictest) | clean |
| `bun run format:check` (oxfmt) | all files formatted |
| `bun test` | 86 pass, 0 fail |
| `bun run build:storybook` | completed |
| `make lint` (root: gofmt, go vet, staticcheck, house rules, worker lint, interface lint, check-system, format) | clean |
| Tailwind probe, inspected by hand | `max-sm:size-11` and `max-sm:[&_svg…]:size-5` are emitted after the base sizes (same specificity, later wins); `--bar-height` is 48px with a 56px phone override |

## What it flagged, and what was fixed

1. **The phone step was not checkable.** `check-system.ts` probed tokens and default-scale classes
   but nothing about the phone step, so the ladder could quietly stop resolving. Added to the probe
   list: `size-11`, `max-sm:size-11`, `max-sm:size-5`, `max-sm:text-lg`, `h-[var(--bar-height)]`.
   A future change that drops the step now fails `make lint`, not a review.
2. **`Layer` had no story.** The new primitive was covered only through the phone mocks. Added
   `Layout/Layer` with `Below the bar` (the bar's toggle is the only close) and `Full height`.
3. **Two story comments still described the retired drawer.** `split.stories.tsx` said the rail
   "drops below" and called the toggle a drawer toggle; both now say what the layer does.

Nothing else was flagged. No arbitrary values, no palette classes, no primitive reads outside
`tokens.css`, no class on a screen.

## The two things no tool here sees

- **Story coverage.** Every state a screen can be in has a story, and the new surfaces do too:
  `Layout/Layer` (open below a bar, full height), `Layout/Split` (phone bar, layer open on a phone),
  `Mocks/Phone — navigation` (bar closed, layer open, workspaces layer), `Mocks/Phone — composer`
  (folded, folded with status, band, above the keyboard, open, running),
  `Mocks/Phone — targets` (the step in place), `Mocks/Phone — composer` reuses the real `Composer`.
  `WorkspaceRow` is storied through `Screens/Workspaces` (both the active row and the `Open` row).
  `ui/sheet.tsx` had no stories and now does not exist.
- **Accessibility basics.** By reading, not by running: the layer has an `sr-only` title, the bar's
  toggle carries `aria-expanded`, Escape closes the layer (Radix), focus moves into the layer on
  open, and reduced motion is covered by the global guard (`globals.css`, animation-duration
  0.01ms). The deliberate gap: the layer is **not modal**, so there is no focus trap — that is the
  price of keeping the bar's own close reachable, and it is written down in `layer.tsx`. Focus
  rings are present on every interactive surface through the primitives. The a11y addon reports per
  story in the owner's run; `make ui` covers the keyboard paths in a real browser. **Neither could
  run in this sandbox** — no browser, no gateway.

## Out of scope, with reasons

- `make ui` (the browser suite): no browser in this sandbox. The `data-slot` names it keys off
  (`workspaces-screen`, `workspace-row`, `composer`, `transcript`) are unchanged by step 07.
- Widget-level keyboard testing on a phone: the owner's own check, on the tailnet build, in step 11.
