# Information Architecture Report — Acornfall

## Navigation Model
Single workspace context at a time. Rail = conversations (primary nav). Workspace switcher = context switch. Settings/Workspaces = places (replace transcript, rail stays = way back). Inspector = question overlay (→ docked panel), never a place.

## Route / Page Hierarchy
```text
/
├── c/:id (conversation: rail + transcript + composer)
├── settings (defaults, theme, sandbox)
├── workspaces (create/open/rename/forget)
└── inspector (overlay ?panel; docked ≥2xl, not a route)
```

## Information Groups
- Conversation: identity (title/id/tags) / state (dot, running, cost) / body (turns: user → tools → assistant) / audit (context/agent/sandbox/run).
- Settings: theme (instant) / workspace (image, network) / defaults (model, thinking, agent + scope).
- Workspaces: list (name, path, active) / create (name only, server validates).

## Search / Filter / Sort Model
No search today. Date groups (Today/Yesterday/This week/Older) + tombstone Deleted group carry scaling to ~50 rows. Future: ⌘K palette (new/go/settings/switch) before full search.

## Cross-page User Flows
- New → empty transcript w/ starters → send → running header → steer/queue → cost updates.
- Surprise answer → Inspector (context diff chips → agent overlay → sandbox/run facts) → back to same scroll place.
- Tune → settings instant-apply → caption confirms scope → Esc/rail returns.

## Scalability Notes
Rail groups + collapse + drawer scale; Inspector dock only where room (2xl); settings sections grow vertically in Measure page.

## Risks and Simplification Options
- Risk: docked Inspector narrows transcript at 2xl — mitigated: collapsible, Measure stays.
- Risk: date grouping needs timestamps — already in panes/header.
- Simplify: if dock rejected, header-anchored toggle alone still fixes the floating-overlay defect.
