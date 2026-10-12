# Interaction Experience Report — Acornfall

## Interaction Principles
Keyboard-first, never keyboard-only. Running work is always interruptible and its pending input always visible. Evidence is never lost (collapse ≠ delete). Every overlay has Esc + focus trap + return-focus.

## State Matrix

| Component/Area | Default | Hover | Focus | Active | Disabled | Error |
|---|---|---|---|---|---|---|
| Rail row | title+dot+id | `…` affordance (touch: always) | visible ring | primary-subtle | — | — |
| Composer send | icon ↑ | tint | ring | press scale | empty→disabled | refused→inline explain |
| Tool card | collapsed 200px completed | expand hint | ring on expand | open | — | full-open + danger tone |
| Slash item | list | + active bg | — | selected | — | — |
| Settings control | value | hint | ring | applied | — | inline message |
| Inspector section | all open on open | chevron | ring | — | — | — |

## Loading / Empty / Error / Success States
- Loading: streaming text + open running card + header working/last-active/cost; scrolled-away → "↓ latest" pill.
- Empty: transcript greeting + starters + `/` hint; rail New; workspaces create.
- Error: refused send restores draft + inline why; guard blocks name reason; tool errors open + copyable mono.
- Success: entry appears; settings apply instantly with scope caption.

## Motion System

| Motion | Duration | Easing | Trigger | Purpose |
|---|---|---|---|---|
| hover/press | 100ms fast | ease-out | buttons/rows | confirm |
| enter/leave | 200ms normal | ease-out | menus/cards | orient |
| dialog/sheet | 300–400ms slow | swift `(.2,0,0,1)` | overlays | arrive |
| chevron | 100ms | ease-out | accordions | disclose |

Reduced-motion: fades only, no slide/scale.

## Keyboard and Mobile Behavior
- Enter is always a newline; sending happens only through Send/Steer/Queue (button-only: a multiline draft must never escape early). *(Superseded 2026-08-29: Enter sends on a fine pointer — a steer while a run is live, and the composer says so — and Shift+Enter is the newline. See `refactor-ux/09-build.md`.)*
- Slash: ↑↓ navigate (wrapping), Enter picks the highlighted command, Esc dismisses for the word; list ≤8 + overflow note.
- Splitter keyboard-resizable; long-press = right-click parity; drawer swipe/Esc.
- Esc closes settings/screens back to conversation; focus returns to trigger.

## Accessibility Notes
Visible focus rings (token `--ring`); status never color-only (dot + label); contrast AA (dark foreground → neutral-200 helps); dialogs labelled; mono micro 11px never for prose; touch targets ≥32px rows, icon buttons labelled.
