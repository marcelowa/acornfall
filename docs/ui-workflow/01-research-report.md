# UI Research Report — Acornfall

## References Inspected

| Source | Why Relevant | Takeaways |
|---|---|---|
| Current `ui/src` (shell, transcript, composer, rail, inspector, settings, workspaces, tokens) | Ground truth | Architecture disciplined; surface starved: hairline-only hierarchy, no elevation, muted-blue only on buttons, 14px transcript, native `prompt`/`details`, Inspector as fullscreen modal, floating toggle overlapping content |
| Linear | Dense pro console, docked panels | Docked resizable right panel; hover/long-press `…` row menus; date-grouped lists; colored dot + legible status; subtle top-edge highlight on panels |
| ChatGPT / Claude web | Reading-first chat | Composer as one rounded card (textarea + controls + icon send inside); user bubble tinted, assistant borderless; empty state as greeting + starters; inter-turn > intra-turn rhythm |
| Raycast | Small-panel craft | Section header icon + right accessory value; kbd styling; 360px panel can feel premium; popover = elevated surface, not same-as-page |
| metricside client (ancestor) | Token pattern origin | Convention-only tokens drift (`text-[11px]`, `text-white`); lesson already encoded in ADR-0016 enforcement |

## External Skills Consulted

| Skill | Available? | Used For | Notes |
|---|---|---|---|
| design-dna | Yes (bundled) | Visual-system framing | Used built-in protocol; no external screenshots to extract from — analysis done from code |
| ui-workflow bundled analysts (research/visual/form) | Yes | Deep parallel audit | Findings integrated below |
| anthropics/frontend-design, vercel web-guidelines, accessibility, motion skills | No | — | Fell back to built-in protocol + WCAG knowledge |

## Patterns Worth Borrowing
- Docked Inspector column at wide screens (orphaned `--inspector-width: 360px` token exists).
- Composer as single card with icon send; steer/queue as popover from send, not duplicated ToggleGroup + Button.
- Turn-aware transcript rhythm (16px intra-turn / 32px inter-turn); collapsed completed tool cards (200px) with expand.
- Date-grouped conversation list; hover-reveal/`…` menus everywhere (align Workspaces rows to rail pattern).
- Instant-apply settings (drop mixed Save model); `RenameDialog` already built — wire it, delete `window.prompt`.
- Real Inter loading (font declared, never shipped); tabular-nums for costs/tokens/ids; dark elevation via surface steps + top highlight, not black shadows.

## Patterns to Avoid
- Default purple gradients, glass cards, generic SaaS sameness.
- Fullscreen modal for ambient info; floating `fixed` toggles over reading surface.
- Native `prompt` / `<details>`; 11px status text; `transition-all`; 500ms sheet; Enter-vs-button inconsistency while running.
- New tokens bypassing `check-system`; classes in screens; `--base-*` reads outside tokens.css.

## Product-Specific Design Implications
- Keep rail / Measure / transcript-scroll-follow architecture — re-skin, don't restructure.
- All beauty work must land as tokens, primitive variants, or new dumb components + stories.
- Dark mode is a first-class surface: popover/dialog cannot equal page surface.

## Recommended Direction
"Calibrated instrument": finish the decisions the system started (real Inter, brand-subtle selection, dark surface ladder, named transitions, swift easing), plus three structural moves: dock Inspector, rebuild composer as card, replace native interstitials with designed equivalents.
