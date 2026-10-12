# 11 — The owner's final pass

Date: 2026-08-29. The owner looked at the shipped build in Storybook, on the phone-width stories,
after the panel's round 1 changes. Two notes, both real, both fixed.

## Note 1 — the settings tabs are too wide on a phone

Five tabs (`Workspace / Defaults / Providers / Appearance / Updates`) in a list that could not
scroll: `TabsList` was `inline-flex w-fit` with no `max-w` and no `overflow`, so on a 390px screen
the row pushed the page wide instead of giving the tabs somewhere to go. The list is
`max-w-full overflow-x-auto` now, and starts at the left where it scrolls rather than centring its
overflow. This was also on the panel's list (TINKERER, round 1: five tabs, no search), which makes
it a miss in the fix round rather than a new finding.

Nothing about the tabs themselves changed: one page per tab, one URL per page.

## Note 2 — a long tool name scrolled the card sideways on a phone

The card header is a flex row, and a flex item defaults to `min-width: auto`: the title refused to
shrink, so an `mcp__…` name pushed the fold control and the status out of the card, and the page
scrolled horizontally on a phone. The title now sits in a `min-w-0 truncate` span, so the name is
what gives way.

The same story had a second, smaller cause: the output `<pre>` was `overflow-x-auto` while every
line already wraps (`wrap-anywhere`), so it offered a scroll area nobody needed. It is
`overflow-hidden` now — a folded card clamps it, an open one wraps.

The inspector's context block had the same pointless `overflow-x-auto` under wrapping text, and was
fixed with it.

## What this round did not change

The direction the panel approved: the rail row's second line, the fold in the card header with two
lines, the phone type ladder, the settings commit moment, the marks. These are two layout defects
in the shipped build, not a re-opening of anything decided.

## Checks

`bun run typecheck`, `bun run lint`, `bun run check:system`, `bun run format:check`, `bun test`
(86 pass), `bun run build:storybook` — green. Page-level overflow at 390px is the one thing left
for a real browser: `make ui` on a machine with a gateway, and the two `Phone` stories beside it.
