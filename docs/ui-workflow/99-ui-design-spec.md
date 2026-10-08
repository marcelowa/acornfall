# UI Design Spec — Acornfall Redesign (Calibrated Instrument)

## 1. Product and User Context
Personal agent console for an owner-operator: dozens of conversations per workspace, tool-heavy turns, sandboxed execution. UI must make long runs readable, steerable, auditable. Desktop-first web (gateway-served), phone-responsive, light+dark.

## 2. Design Goals
1. Beautiful without decoration: gap quality, type honesty, true elevation.
2. Usable without learning: steer/queue unambiguous, rail scannable, Inspector non-blocking, settings one model.
3. Zero architecture regressions: dumb screens, token-only styling, Storybook states, `check-system` green.

## 3. Reference and Skill Sources
### References
- Current `ui/src` audit; Linear (docked panel, grouped rail, `…` menus); ChatGPT/Claude (composer card, turn rhythm, starter empty state); Raycast (360px panel craft, kbd); metricside (convention-drift lesson).
### External Skills Consulted
| Skill | Available? | Influence |
|---|---|---|
| design-dna | Yes | 3-dimension framing; effects explicitly off |
| ui-workflow analysts (research/visual/form) | Yes | Findings integrated |
| frontend-design, web-guidelines, accessibility, motion, typography-audit | No | Built-in fallback; WCAG AA applied manually |

## 4. Page and Flow Overview
- Conversation (default): rail + transcript + composer + Inspector + notice.
- Settings / Workspaces: replace transcript, rail persists as back.
- Inspector: overlay today → header toggle + docked 360px column ≥2xl.

## 5. Information Architecture
Single workspace context; rail = primary nav (date groups: Today/Yesterday/This week/Older + Deleted tombstones); workspace switcher = context; settings/workspaces = places; Inspector = question, not place. Future ⌘K before search.

## 6. Layout and Component System
- `Rail` primitive (head|list|foot, owns surface/padding/notch); `Split.header` slot (desktop title + Inspector toggle, kills floating button); transcript turn gaps (inter 32 / intra 16); ToolCard collapsed 200px completed + expand (running/error open); composer single card w/ icon send + busy popover; shared inspector `Fact`; styled deleted disclosure; centered empty stacks; Slash ≤8 rows + `data-active`.
- Workspaces rows align to rail `…` pattern; active row treatment; Grid gains responsive story (or stays unused).

## 7. Visual System
### Colors
`--primary-subtle` (+fg) for selection; `--surface-highlight` top edge; neutral-850/875 dark surfaces (popover→850, dialog→card); overlay 70% dark; dark fg→neutral-200; dark accent separated from border; complete 200 ramps.
### Typography
Ship Inter + preload; transcript 16px; scale contract (3xl page H1 → 2xs mono-micro only); tabular-nums on numbers.
### Spacing
4px grid; transcript rhythm 32/16; dialog 16→24.
### Radius / Shadow / Border
Radius doctrine xs–2xl; light shadows as-is; dark = surface steps + highlight.
### Iconography / Illustration
Lucide only; headers icon + right value; dot + label status; text-led empties.

## 8. Interaction System
### Component States
See `06-interaction-report.md` matrix. Decided: button-only send (Enter is always a newline); slash arrows/Enter-pick/Esc; RenameDialog wired; Esc closes screens w/ focus return.
### Loading / Empty / Error / Success
Streaming + open running card + header state; scrolled-away → "↓ latest" pill; starter empties; refused/guarded sends explain inline with draft kept; evidence never deleted.
### Motion
100 hover / 200 enter / 300–400 dialog, swift `(.2,0,0,1)` entries, named props only, reduced-motion fades.
### Accessibility
AA contrast, visible `--ring` focus, never color-only, labelled icon buttons, ≥32px targets, mono-11px never prose.

## 9. Content and Copy System
Quiet expert voice. Action verbs; numbers with units; destructive names consequence. Starter, queued, caption, collapsed-count copy per `07-content-report.md`. Ban AI filler.

## 10. Responsive Behavior
< lg drawer + bar; lg–2xl resizable rail + header toggle; ≥2xl optional docked Inspector. Composer wraps to rows on phone; slash above textarea.

## 11. Implementation Notes (sequenced PRs, each Storybook + lint green)
1. Tokens: Inter, primary-subtle, 200 ramps, 850/875, highlight, swift ease; register in `globals.css`; update palette/shape/typography stories + `check-system.test.ts`.
2. Dark ladder: popover 850, dialog `bg-card`, overlay 70%, fg 200, accent split.
3. `transition-all` → named; sheet 500→350; reduced-motion guard.
4. `Rail` primitive + remove screen classes; fix duplicate comment; wire RenameDialog; styled deleted group.
5. Transcript rhythm (turn wrapper) + body 16px + tabular-nums; ToolCard collapse; empty stack; latest pill.
6. Composer card + busy popover + button-only send; Slash keyboard + cap.
7. Inspector header toggle (+ docked 2xl column, collapsible); shared `Fact`.
8. Settings instant-apply (drop Save); Workspaces `…` + active row; Grid responsive.
- No file may add `className` in `src/screens/`, arbitrary values, palette colors, or `--base-*` outside tokens.css.

## 12. Risks, Assumptions, and Follow-ups
- Conflicts resolved: brand-subtle vs gray selection → brand wins (identity); dock vs overlay → both (docked ≥2xl, overlay below); instant vs explicit save → instant + caption; collapse vs full output → collapse completed only.
- Assumptions needing confirmation: docked Inspector; 16px transcript; instant-apply settings.
- Not tested: real-user triage timing; hypervisor sandbox UI states beyond existing panels.
- Skills unavailable: frontend-design, web-guidelines, accessibility, motion — revisit when installed.

## 13. Prototype Recommendation
Option 1 (recommended): one key page — conversation with composer card + docked Inspector + grouped rail, light+dark, in Storybook (not `docs/prototype/` HTML) to stay in-system. Await user confirmation before building. Then implement PRs 1–8 above.
