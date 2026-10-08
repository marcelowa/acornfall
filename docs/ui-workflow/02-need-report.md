# UI Requirements Report — Acornfall

## Product Positioning
Personal agent console: local-first Go gateway + sandboxed execution, multi-conversation, per-workspace workers. The UI's job is to make long-running, tool-heavy agent work *readable, steerable, and auditable* — not to demo chat.

## Target Users / Personas
- **Owner-operator** (primary): runs own workspaces, 10–50 conversations, reads tool output, cares about cost/tokens/sandbox.
- **Delegator**: spawns subagents/peers, checks rail badges, resumes agent-created conversations.
- **Tinkerer**: tunes defaults (model/thinking/agent), guards, commands; opens Inspector when answers surprise.

## Jobs To Be Done
- Resume the right conversation fast; know which is running and what it cost.
- Read a turn (user intent → tool evidence → answer) without losing place.
- Intervene mid-turn (steer now vs queue behind) without ambiguity.
- Audit what the model saw / which tools ran / where they ran.
- Change settings without learning two save models.

## Key User Scenarios
1. Steering a live run: type while running → queued chip visible → steer vs follow-up choice explicit → abort always available.
2. Triage: open app → date-grouped rail → dot + cost → select → transcript lands at end, follows live.
3. "Why that answer": Inspector → Context changes chips → Agent overlay explanation → Sandbox/Run facts.
4. New workspace run: create → empty transcript with guidance → `/` command discoverable via keyboard.

## Feature and Page Priority

| Priority | Feature/Page | User Value | Notes |
|---|---|---|---|
| P0 | Transcript rhythm + readability | Core read surface | Turn gaps, 16px body, collapsible tool cards, jump-to-latest |
| P0 | Composer card rebuild | Send/steer clarity | Single card, icon send, no duplicated busy controls |
| P0 | Rail scanning | Find conversations | Date groups, brand-subtle active row, wire RenameDialog |
| P0 | Inspector form | Audit without blocking | Header-anchored toggle now; docked column ≥2xl next |
| P1 | Visual tokens completion | Premium feel | Inter, primary-subtle, dark ladder, highlight, swift ease |
| P1 | Settings single save model | No confusion | Instant-apply + caption |
| P1 | Slash keyboard + empty states | Discoverability | Arrow/Enter/Esc, starter prompts |
| P2 | Workspaces alignment, Grid responsive, jump pill | Consistency | `…` menus, active treatment |

## Required States
- Empty: rail ("No conversations yet" + New), transcript (greeting + starters + `/` hint), search-less lists.
- Loading: streaming assistant + running tool cards open; header working indicator + last-active + cost.
- Error: refused send explained inline; tool error cards stay open; guards say why.
- Success: sent/steered confirmation via transcript entry, not toast.
- Edge: 400-line tool output collapsed; scrolled-away stops follow + offers jump; deleted = tombstone group (styled, not native `<details>`).

## Success Metrics
- Time to resume correct conversation; steer-vs-queue error rate ≈ 0; Inspector opened without losing transcript place; zero native-primitive sightings; `make lint` (check-system) green.

## Assumptions / Risks
- Users are technical; mono ids/costs acceptable at 11px mono-only.
- Docked Inspector assumption needs user confirmation (screen space vs overlay).
- Inter shipment (~46KB) acceptable with preload.
