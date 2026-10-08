# Visual Design Report — Acornfall

## Visual Concept
**Calibrated instrument.** Finish every decision the token system started. Precise, quiet, layered, trustworthy. Beauty from spacing quality, type honesty, and elevation truth — not decoration.

## Aesthetic Direction
- Neutral oklch (hue 286) stays; muted blue brand stays but *participates* (selection, focus) instead of button-only.
- Light: restrained shadows as today. Dark: surfaces step up in lightness + top highlight, not black shadows.
- Radius doctrine: xs 2 kbd/tag; sm 4 inner; md 8 buttons/rows; lg 12 popover/dialog; xl 16 card/sheet; 2xl 20 empty-state containers.
- No gradients, no glass, no generic SaaS purple.

## Design Tokens (all in `tokens.css` + `globals.css` registration; check-system stays armed)

### Color
| Token | Value | Usage |
|---|---|---|
| `--primary-subtle` | `color-mix(primary 10%, transparent)` light / 14% dark | Active rail row, selected tab |
| `--primary-subtle-foreground` | brand-700 light / brand-300 dark | Text on primary-subtle |
| `--surface-highlight` | transparent light / `inset 0 1px 0 oklch(1 0 0 / .07)` dark | Popover/dialog/sheet top edge |
| `--base-neutral-850/875` | oklch .243/.257 | Dark popover / dialog surfaces |
| `--base-*-200` (success/warning/danger/info) | fill 100→300 gap | Complete ramps |
| dark `--popover` | neutral-850; dialog uses `bg-card` | End popover==card zero-separation bug |
| dark `--overlay` | 70% | Real scrim |
| dark `--foreground` | neutral-200 (not 100) | Kill small-text glow |
| dark `--accent` | mix(800 70%, 700) | Separate interactive gray from border/input lines |

### Typography
| Role | Style | Usage |
|---|---|---|
| Page H1 | 30px semibold | One per settings/workspaces screen |
| Dialog/empty title | 24px | Inspector title, empty transcript |
| Section | 20px / 16px | Panels, transcript body 16px (`text-lg`) |
| UI default | 14px | Forms, rows |
| Dense/meta | 13/12px | Secondary rows, badge/kbd |
| Mono micro | 11px tabular-nums | ids, timestamps, cost — only mono use of 2xs |

Ship real Inter (`@fontsource-variable/inter` + preload); `tabular-nums` on numeric spans.

### Spacing
4px grid unchanged. Transcript: inter-turn 32 / intra-turn 16. Dialog padding 16→24. Rail `p-2` via primitive.

### Radius / Shadow / Border
Shadows unchanged in light. Dark relies on surface steps + highlight. Keep 1px hairlines; add elevation only at popover/dialog/sheet.

## Iconography / Illustration
Lucide only; no emoji. Section headers gain icon + right accessory value; status = colored dot + legible label (≥12px); empty states text-led, no mascot.

## Motion Tone
Quiet + swift: hover/press 100ms, enter/leave 200ms, dialog 300–400ms (sheet 500→350). Named props only (no `transition-all`). New `--base-ease-swift: cubic-bezier(.2,0,0,1)` for overlay entry. `prefers-reduced-motion` global fallback.

## Anti-patterns to Avoid
Arbitrary values, palette classes, `--base-*` outside tokens, screen classes, `transition-all`, native prompt/details, 11px non-mono text, floating toggles, button-only brand.

## Design-DNA Notes
```json
{
  "designSystem": { "neutralHue": 286, "brand": "muted blue oklch 255-262", "typeScale": "11-30px Inter", "grid": "4px", "radius": "2-20px", "elevation": "light-shadow / dark-surface-step+highlight" },
  "designStyle": { "mood": "precise quiet trustworthy", "language": "instrument, not marketing", "density": "restrained, gap-quality", "ornament": "none" },
  "visualEffects": { "enabled": false, "note": "no canvas/webgl/particles; motion is token-timed fades/slides only" }
}
```
