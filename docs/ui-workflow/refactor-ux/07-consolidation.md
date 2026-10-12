# 07 — Consolidate

Date: 2026-08-29. Structural pass only: nothing here changes what a folded, running or settings
row looks like. The approved direction (steps 05–06) is what step 09 builds on top of this.

## What was inventoried

| Where | Duplication found | Done |
|---|---|---|
| `components/transcript/tool-card.tsx`, `thinking-card.tsx`, `summary-card.tsx` | The same shell three times: card surface, header row, body, `PaneFooter`, fold state, fold button. And the copies had drifted: summary folded to `max-h-24` — a spacing step — while its siblings used component tokens for the same decision | Merged onto `PaneCard` |
| `components/settings/settings-screen.tsx`, `providers-section.tsx`, `update-section.tsx` | "Titled group" written out per page (title + intro + children), and "labelled field" written out per control | Merged onto `SettingsGroup` + `SettingsField` |
| `components/inspector/*` | Nothing left: `Fact`, `inspector-sections.tsx` and `inspector-panel.tsx` already carry the shared parts. The remaining finding there (native `<details>` beside chevron sections) is a step 09 change, not duplication | Left |
| `conversation-row.tsx` and `workspaces-screen.tsx` row menus | Both open a `…` `DropdownMenu`, with different items and different destructive gestures | Left, on purpose |
| `components/composer/*` | `picker`, `slash-menu`, `choice-control` share a look but not a job | Left |

## What merged

1. **`components/transcript/pane-card.tsx`** — the shell every transcript card shares: surface,
   header row (`leading`, `title`, `aside`), the body, `below`, the footer and the fold. The three
   cards now say only what is theirs: their body element, their fold rule, their words, their slot
   and status. The folded height is named once per card (`foldHeights`), because Tailwind compiles
   the literal classes it can read and a computed class name is a class that does not exist.
   `--summary-card-collapsed-height: 96px` joins its two siblings in `tokens.css`: the same pixels
   the spacing step gave, now a component token like the others.
2. **`components/settings/settings-group.tsx`** — `SettingsGroup` (title, optional intro, children)
   and `SettingsField` (a `2xs` muted label over the control). Used by three groups and two fields
   in `settings-screen.tsx`, and by the group in `providers-section.tsx`. This is also the place the
   approved "one commit moment per settings page" change will land — once, not four times.

## What stayed, and why

- **The row menus.** Sharing them would mean an items-prop abstraction over about fifteen lines
  each, with different destructive gestures inside; the indirection would cost more than the
  duplication does (`/deslop`: an abstraction that does not reduce real complexity is not a win).
- **`update-section.tsx`.** Its blocks are as often notices as groups (a badge, a state line), so
  half of it does not fit the group shape; it is reworked anyway for the commit-moment change.
- **The inspector.** Already consolidated in an earlier pass.

## Verification

`bun run typecheck`, `bun run lint`, `bun run check:system`, `bun run format:check`, `bun test`
(77 pass), `bun run build:storybook`, and `make lint` at the root (gofmt, go vet, staticcheck, the
house rules, worker and interface lint, check-system, format) — all green.

`make ui` was not run: it needs a running gateway and a browser, and this sandbox has neither. The
`data-slot`, `data-status` and `data-live` attributes the suite keys off are unchanged, and the
class strings the merge produces are the same ones each card wrote before.
