# 10 — Panel on the look (run 4)

Date: 2026-10-15. The same three personas from `icp.md`, this time against the **shipped look**:
the four release files, `design.md` and the direction, the measured numbers, and the live pages.
They judged computed sizes, control boxes and composited colours — not rendering by eye, and the
document says so below. Their words are unedited.

Status: **1 of 3 landed** — TINKERER answered; OWNER-OPERATOR and DELEGATOR are running.

## TINKERER

I reviewed the shipped look: the four release files, `design.md` and `05-palette.md`,
`/tmp/look-metrics.txt`, and my own measurements over headless Chromium — all thirteen stories at
1280 and 390 (light, and dark by forcing the `dark` class) plus the live `/update?workspace=general`
and `/settings/install` pages at both widths. No screenshot; I judged computed font sizes, control
boxes, and composited pixel colours, not the rendering by eye.

- **keep** — the facts layer: 11px/12px mono muted with `tabular-nums` for tags, dates and sizes,
  under a 13/14px sentence, with one primary Install. Nothing moves, nothing spins.
- **cut** — the picker's second copy of the running release, the second "Restart pending" with its
  second Restart button, the second check control on the recovery screens, the dead backup-note +
  VM + Install band on the up-to-date card.
- **confused-by** — two accent-highlighted rows that mean different things (the pinned running row
  and the target row); notes at 16px in the card and 12px raw in the "between" list; 32px toggles
  sitting next to 44px buttons on the phone.
- **would I keep using this** — yes, but I'd fix the duplicates before the owner shows it again: a
  page that lists the same version twice is a page I stop trusting exactly when I'm deciding
  whether an update is safe.

### Findings, with what says it

1. **The picker prints the running release twice, and both the pinned row and the target row wear
   the accent.** `release-screen.tsx`: the `runningRow` effect races the list read and is never
   cleared when the list already contains `current`, then the picker prepends it and passes
   `current` to it. In `/tmp/look-metrics.txt` v0.9.28 appears at index 0 and index 6 in seven
   stories, and in `up-to-date` v0.9.33 appears twice back to back with `bg-accent/40` on both. Live
   today the pinned copy didn't render (the list read cancelled the running read), so the stories I
   review are not the picker the app gives me — a race, not a difference in intent. Change: ignore
   `runningRow` once the list holds `current`, and never pass `current` to the pinned row.
2. **Restart pending is stated twice and offers two identical Restart buttons.** `StateLine` prints
   "Restart pending" + facts + a 32px Restart at top 180; `release-restart` prints the warning Badge
   "Restart pending" + a near-identical sentence + a second 32px Restart at top 268. Both call
   `onRestart`. Change: one block, one button.
3. **Every toggle stays 32px on the phone**, against `design.md`'s "below sm every button is 44px …
   no exceptions": at 390 Keep VMs 94×32, Start clean 101×32, Pre-release builds 139×32, on/off
   43×32, live and in stories; everything else is 44 (Back, Install, Check now, Restart) or 50
   (rows). `ui/src/components/ui/toggle.tsx` only, unlike `button.tsx`, has no `max-sm:h-11`. Change:
   add it — the VM choice and the pre-release switch are the two controls a thumb must hit.
4. **The bar's update mark changes tap width and arrow size between states on the phone.**
   `release-mark.tsx`: available uses `size="sm"` → 36×44 with a 16px arrow at 390; restart uses
   `size="icon-sm"` → 44×44 with a 20px arrow. At 1280: 88×32 vs 32×32. Change: keep a 44-wide hit
   square for available on the phone, the tag is hidden there anyway.
5. **The notes size is the renderer's, and the same slot prints at two steps.** `.markdown {
   font-size: var(--text-lg) }` → 16px/24 at 1280 and 390, in every notes story and live;
   `05-palette.md` says notes at `base` (14 desktop / 15 phone), and the card prints "This release
   shipped no notes." at `base`. I checked the built CSS: `.markdown` sits outside
   `@layer utilities`, so `Markdown className="text-base"` would silently lose. My vote: keep 16 —
   it's the size I already read the transcript at, and 14px prose next to a 13px tag reads as a
   bigger tag, not writing — but then fix the direction and lift the no-notes sentence to match; as
   shipped, the card changes size depending on whether notes exist.
6. **The same words print at 12px muted in "what changed in between", raw.** `Between` renders
   `{release.notes}` as `Text size="xs" tone="muted"` (16 vs 12 at 1280, 16 vs 13 at 390) and not
   through `Markdown`, so a real body with `##` or `**` prints the characters. Change: render those
   notes as markdown, at `base` at least.
7. **In light, the current-row highlight is nearly invisible; the running badge sits just under the
   small-text floor.** Composited: accent row [249,248,244] vs page [252,250,247] (Δ3) with a white
   card; dark row [27,23,19] vs page [13,9,6] (Δ14). The soft `running` badge (bg-muted +
   muted-foreground, 11/12px) is 4.39:1 in light, against the 4.5 floor (5.66 in dark); the page's
   11px muted facts are 4.62. Change: if the accent is the only "you are here" mark, give it a
   visible step; check the neutral badge against the floor.
8. **Refusals have no tone, and the list caption lies when the list is empty.** `source-refused`:
   the state line reads "Newer release: v0.9.33" in the normal voice while the list's refusal prints
   in the default colour where the rows should be, above "From the twenty most recent…" (the caption
   renders unconditionally). `no-such-release` adds two Check now buttons (32px outline and 24px
   ghost, same handler); `rolled-back` has the same pair. Change: tone the refusal like the
   rolled-back block, drop the caption when there are no rows, one check control per screenful.
9. **Up to date still shows a full install card with an inert band.** The card renders the running
   release with the backup note, the Keep VMs / Start clean toggles, and a disabled Install, so the
   whole cost-and-press band does nothing while the state line says "Up to date". Change: for the
   running relation, keep the notes, cut the backup note, the VM choice and the Install button.
10. **Small stuff.** The running tag prints three times in the first screen (header `acornfall
    v0.9.28`, state facts, picker row); a pre-release row says it three ways (tag `-rc.1`, the `pre`
    mark, "pre-release" in the facts line) — keep one of the latter two.

One note on the numbers file, since the owner reads it raw: the per-story `h1=14px` and `state=14px`
columns are not the page's title and state title — the CDP probe found the first `h1` in a story
document is Storybook's own "No Preview" (14px), and `state` measured the slot's inherited body
size. The page's h1 is `xl` = 20px and the state title is 13px/14px, as the focused block says. No
horizontal overflow anywhere, which the panel reproduced.
