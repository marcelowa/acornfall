# UI Form and Layout Report — Acornfall

## Interface Type
- App shell: rail + transcript + composer; settings/workspaces replace transcript; Inspector overlays (→ docks).

## Page Inventory

| Page | Purpose | Key Components | Priority |
|---|---|---|---|
| Conversation (Shell) | Read + steer | Rail, Transcript, Composer, Inspector, Notice | P0 |
| Settings | Defaults/theme/sandbox | SettingsScreen (instant-apply) | P1 |
| Workspaces | Create/open/rename/forget | WorkspacesScreen (`…` menus) | P2 |

## Layout Paradigm
Keep: `Page → Split(rail/pane) → Stack(notice, transcript) + composer`; `Measure wide` readability; transcript owns scroll + follow (80px threshold); rail 280px resizable 200–480, collapsible to 40px strip, drawer < lg.

## Navigation Model
Rail conversation list (date-grouped) + workspace switcher + New/Settings foot; desktop main-pane header (title + Inspector toggle) replaces mobile-only bar; Inspector docked 360px ≥2xl, dialog below.

## Component Strategy
- New `Rail` primitive (head | list scroll fill | foot; owns `bg-card border-r p-2`, `pr-8` toggle notch as variants) — removes raw classes from `workspace-view`.
- New shared inspector `Fact` atom (replaces 3 private copies) with `tone`.
- Transcript turn wrapper: inter-turn `2xl` / intra-turn `lg` gaps via variant; `ToolCard` collapsed-height 200px completed + expand, running/error full-open.
- Composer card: one rounded card containing textarea + controls + icon send; busy choice as popover from send.
- Hoisted `RenameDialog` wiring; styled deleted-group disclosure (no native `<details>`); centered empty transcript stack.
- `Split` gains optional `header` slot (desktop title row).

## Responsive Strategy

| Breakpoint | Layout Behavior | Notes |
|---|---|---|
| < lg | Rail = drawer + top bar title | Keep Sheet |
| lg–2xl | Resizable rail column; header-anchored Inspector toggle | Kill floating `fixed` toggle |
| ≥ 2xl | Optional docked Inspector 360px (`--inspector-width`) | Collapsible; dialog remains for smaller |

## Density and Scanning Model
- Rail rows `py-1.5 text-sm`, title + dot + `#id ·tags` mono; active = `--primary-subtle`; spend in tooltip.
- Transcript body 16px; user tinted bubble right, assistant borderless; PaneFooter timestamp-left/controls-right.
- Slash list ≤8 rows, internal scroll, `data-active` highlight.

## Trade-offs
- Docked Inspector costs 360px at 2xl only — acceptable; overlay stays default below.
- Collapsed tool cards hide evidence one click away — running/error exempt, expand explicit.
- Instant-apply settings lose explicit confirm — caption "takes effect next sandbox/run" covers it.
