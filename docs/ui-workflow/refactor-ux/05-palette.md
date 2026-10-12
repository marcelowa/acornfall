# 05 — Colour scheme and the surface rules

Status: **confirmed by the owner, 2026-08-29** ("continue"): roles, phone ladder, size ladders
and motion as written. Grounded in the personas in `icp.md`
and the panel's findings in [04-panel-journeys.md](04-panel-journeys.md). Every value below is a
token in `ui/src/styles/tokens.css` or a change to one; nothing here is a class invented at a call
site (ADR-0016, `make lint`).

## What the palette must do for these personas

One operator, long sessions, often at night, reading evidence rather than decoration. The palette
must make three things true at a glance:

1. **A fact is quiet, a signal is loud.** Spend, tokens, timings and ids are facts: they must be
   comparable down a column without competing with titles or answers.
2. **Live state is honest.** A running dot means the run moved recently; when it stops moving, the
   dot must stop claiming life, and the row must carry the time.
3. **Nothing shouts twice.** One warm accent for action, blue for the queue/stop family, ember and
   red reserved for warning and failure.

## Colour: keep the hues, settle the roles

The hues already answer the brief — bronze accent (`--base-brand-*`) on warm bark neutrals
(`--base-neutral-*`), blue secondary (`--base-secondary-*`), ember warning, blue info. The
panel's findings are about **roles**, not hues, and they need no new colour ramp:

| Role | Token today | What changes |
|---|---|---|
| Spend, tokens, ids, timings | row `title` tooltip only; `muted-foreground` elsewhere | stays `--muted-foreground`, always mono + `tabular-nums`, at one step (`2xs`) — a fact, never `--primary` or `--success` |
| Running | `--primary` dot, `animate-pulse` | unchanged while the run moves; when the run's last update falls outside the freshness window the dot becomes `--muted-foreground` and the row shows the time |
| Unread | `--success` dot | unchanged |
| Steer / action | `--primary` | unchanged |
| Queue / Stop | `--secondary` / `--destructive` | unchanged |
| Stale or died | none | covered by the muted dot plus the time; no sixth colour |

No new primitive ramp, no new accent. `--primary-subtle`, `--surface-highlight`, `--code-background`
and the rest of the semantic layer stay as they are.

## Type: one ladder, no collisions, at both widths

The ladder today is 11 / 12 / 13 / 14 / 16 / 20 / 24 / 30 (2xs → 3xl), and below 639px
`globals.css` shifts `2xs/xs/sm` up one step while `--text-base` stays 14px — so on a phone
`text-sm` and `text-base` are both 14px, and chrome reads as content (verified,
`styles/globals.css:190-196`).

Proposal — on a phone, every step up to `lg` moves one notch, so the phone ladder is even and
nothing collides:

| Step | Desktop | Phone (below 640px) | Used for |
|---|---|---|---|
| `2xs` | 11 | 12 | ids, timestamps, cost, kbd |
| `xs` | 12 | 13 | badges, captions, dense meta |
| `sm` | 13 | 14 | the UI default: rows, forms, buttons |
| `base` | 14 | 15 | panel prose, list body |
| `lg` | 16 | 16 | transcript body (unchanged — 16px is the settled reading size) |
| `xl`+ | 20 / 24 / 30 | unchanged | page and dialog titles |

Rule that follows from it: a fact (`2xs`) never sits directly against content (`lg`) without the
UI default (`sm`) between them, and mono is for ids, timestamps, cost and code — never for prose.

## Icons and buttons: one ladder each

Counted in `ui/src`: `size="sm"` 109 times, `size="xs"` 22, `size="lg"` 7. The ladder exists; it
just is not named anywhere.

| Control | Sizes | Rule |
|---|---|---|
| Icon | 12 / 14 / 16 / 20px | an icon is one step above the text it labels, same row height as the control it sits in |
| Button | 24 / 32 / 36 / 40px (`xs / sm / default / lg`) | one row height per surface: composer controls `sm`, row actions `xs`, page actions `default` |
| Row | 24 / 32 / 40px | a rail row, a list row and a settings row do not each pick their own |

## Motion

Motion answers an action (menu, dialog, drawer, collapse, focus) or reports live state (running
dot, thinking dots). It never runs on mount or on scroll, and `prefers-reduced-motion` keeps its
global guard (`globals.css:200`). The existing 100 / 200 / 300ms steps and `ease-swift` stay.

## What this does not change

- The hue families, the semantic names (shadcn's), and the two-theme structure.
- The transcript's 16px body, the 32/16 turn rhythm, the tool-card collapse thresholds.
- Anything a later multi-user platform would need to re-decide: this is the foundation, not a
  multi-tenant theme system.

## Confirmation needed

1. Colour roles as tabled (facts quiet, stale dot muted, no new hue).
2. The phone ladder 12 / 13 / 14 / 15 / 16 with `lg` fixed at 16.
3. The icon, button and row ladders named as rules.
4. Motion unchanged, with the no-mount-animation rule added.

Then step 06 turns these rules plus the accepted panel changes into Storybook mocks.
