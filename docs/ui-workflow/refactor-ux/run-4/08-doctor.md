# 08 — Framework doctor (run 4)

Date: 2026-10-15, over the consolidated `ui/` and the gateway, before step 09 builds the approved
direction.

## What ran, and what it said

| Check | Result |
|---|---|
| `bun run check:system` | tokens resolve, defaults do not, screens carry no classes |
| `bun run lint` (oxlint) | 0 warnings, 0 errors, 184 files |
| `bun run typecheck` (tsc, strictest) | clean |
| `bun run format:check` (oxfmt) | all files formatted |
| `bun test` | 109 pass, 0 fail |
| `bun run build:storybook` | completed |
| `make lint` (root: gofmt, go vet, staticcheck, house rules, worker lint, interface lint, check-system, format) | clean — staticcheck clean, house rules 3 checked |
| story render pass | 13 stories × 2 widths (1280, 390) in headless chromium: no console error, no horizontal overflow (the only 404 is Storybook's own `favicon.ico`) |

## What it flagged

**Story coverage — nothing missing for what exists.** The release surface ships as mocks this
round; all thirteen render, and between them they cover every state in the direction's table:
checking is the only one shown as a line rather than its own story (it leaves the last answer on
screen, so it is a variation of the states that have stories). **Step 09's checklist is that same
table**: page states (up to date, newer, restart pending, restarting, lost the gateway, rolled
back, refused source, dev), the picker with and without pre-releases, a picked version, the bar's
mark at both widths, and the runs dialog. A product story missing for any of them is a state nobody
reviewed.

**Accessibility — one build requirement.** The primitives carry visible focus rings (button, input,
toggle, toggle group, tabs, dialog) and the dialog keeps Radix's focus trap, so the surface inherits
the basics. Two things are the build's to get right, flagged here because the mock cannot prove
them: **the picker rows are `div`s in the mock and must be real buttons or links in the product**
(keyboard, focus, and the phone's tap target), and **the bar's mark must keep an accessible name
that carries the tag** when it is the bare arrow on a phone. Nothing on this surface moves, so the
reduced-motion guard changes nothing.

## Out of scope, with reasons

- **`make ui`** (the console browser suite, `tools/check-ui.mjs`) needs a running gateway built with
  the new API and a real console page. Chromium is present in this sandbox now, so step 10 runs it
  against the built surface rather than pretending it passed here.
- **A full a11y audit with the Storybook addon** — the addon reports per story in the owner's run;
  this sandbox has no interactive reviewer. The two requirements above are what reading found.

## Checks made it green

Nothing needed fixing beyond what step 07 consolidated; the two a11y items are written into the
step 09 checklist rather than left implicit.
