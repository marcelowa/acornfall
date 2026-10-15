# 10 — Panel on the look (run 4)

Date: 2026-10-15. The same three personas from `icp.md`, this time against the **shipped look**:
the four release files, `design.md` and the direction, the measured numbers, and the live pages.
They judged computed sizes, control boxes and composited colours — not rendering by eye, and the
document says so below. Their words are unedited.

Status: **3 of 3 landed**, round 1 — TINKERER, OWNER-OPERATOR and DELEGATOR answered; their own
findings are marked fixed in the table at the end, and the panel re-runs on the fixed build.

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

## OWNER-OPERATOR

**keep**: The spine of the page — state line, the offered release with its notes, the cost
paragraph, Install, then the picker — and the rows: mono tags down one column, date/size/channel at
2xs, whole-row 50px targets on the phone, and no sideways scroll in any of the thirteen stories or
on the four live URLs at 1280/390.

**cut**: The joined "Keep VMs | Start clean" pair on a phone — 94×32 and 101×32, touching, no gap,
and the one that wipes VMs sits flush against its opposite; and the "current row" tint that is
1.02:1 in light, because a mark I cannot see is worse than none.

**confused-by**: Which mark does what in the bar — the update mark is a plain foreground arrow with
an 11px muted "v0.9.33" (no accent anywhere), and the restart mark is a bare `RotateCw`, which reads
like "reload"; and "running" is a grey pill on the release page while the rail's running dot is
bronze — same word, two looks, and a third in `design.md`.

**would I keep using this**: Yes, this is the one page I would open instead of a terminal. But in
light theme I would wonder why nothing on it looks selected or pressable, and on a phone I would
fat-finger the VM choice — that costs me a second look every visit.

### Findings, worst first

1. **The update mark is not the accent the direction promised.** `release-mark.tsx` renders
   `variant="ghost"` with no colour class; the live arrow computes to the text foreground while
   `--primary` is the bronze. 05-palette: "The mark is the only accent, and it is the same
   `primary`". Change: `text-primary` on the arrow (tag stays muted).
2. **Selection is invisible in light, and weaker than hover in dark.** `ReleaseRow` current =
   `bg-accent/40`; live dark 1.19:1, live light 1.02:1; plain hover (`bg-muted`) is 1.33:1 dark /
   1.05:1 light; the armed segment of "Keep VMs" (`bg-accent` opaque) is 1.46:1 / 1.05:1, and
   `/settings/install`'s selected "on" measures barely off the page. `design.md` gives "selection"
   to `--primary`. Change: current row and armed segment take `primary`.
3. **The one thumb ladder misses the toggles.** `button.tsx` writes `max-sm:h-11` for every size,
   `toggle.tsx` has no phone step: live at 390 Keep VMs 94×32, Start clean 101×32, Pre-release
   builds 139×32, on/off 43×32, and the Settings tabs 32 tall. Change: give both the phone step.
4. **The phone mark is off the ladder.** Live 390: the available mark is 36×44 with a 16px arrow;
   the restart mark in the same slot is 44×44 with a 20px arrow. Change: a 44×44 square with the
   20px arrow.
5. **The phone bar is 48px, not the 56px the direction says.** `tokens.css` sets `--bar-height:
   48px` unlayered; `globals.css`'s phone override lives in `@layer base`, so the unlayered value
   wins. The stories hide it because they draw their own `h-14` bar. Change: get the 56px step to
   apply for real, and have the stories render the app's bar.
6. **The notes print at `lg`, not the directed `base`.** `.markdown` sets `--text-lg` (16px at both
   widths) while 05-palette said `base`. Change: pick one and record it.
7. **The in-between notes are prose set in the fact tone.** `Between` used `Text size="xs"
   tone="muted"` for whole sentences — the muted step is for ids, timestamps and cost, never prose —
   and the block ran 1201px at 390. Change: prose in the foreground, or one line each.
8. **"running" wears a different colour from running.** The card and row used a neutral badge while
   the rail's running dot is bronze. Change: one running treatment.
9. **The running row got added twice on the live page.** At 1.2s after load, 21 picker rows with
   v0.9.20 at the top and again in place; at 4s, 20 rows. Change: drop the running row when the list
   holds it, and give it its own mark rather than the current-row tint.
10. **Two smaller ones.** (a) In light the 11px facts sit at 4.62:1 — AA-pass but the smallest text
    at the lowest ratio, twenty rows of it. (b) The phone gutter here is 24px while Settings uses
    16px: `/update` content starts at x=24, `/settings/install` at x=16.


## DELEGATOR

I judged the code, `/tmp/look-metrics.txt`, and the live page as rendered (headless Chromium over
CDP, computed styles and geometry at 1280 and 390, light and dark — no image: every number below is
measured).

**keep** — the quiet mark (arrow + 11px mono tag, 88×32) and the calm two-line state line: a
check-in costs one look, and nothing moves.

**cut** — the second Restart notice and its twin button, the second Check now in the
gateway-silent state, and the "dev build — not a release tag" line that prints before the gateway
has answered.

**confused-by** — the bare amber `RotateCw` in the bar (reload or restart?), two identical Restart
buttons, "Installing…" that never changes, and 16px release notes burying the press.

**would I keep using this** — the page, yes; the bar as my "does anything need me?" check-in, no —
not while the one state that needs me is a 2.97:1 unlabelled icon.

### Findings, worst first

1. **Nothing in the look says my runs are live before I press Install.** `runs`/`runsActive` are
   read only inside `startUpdate` and the dialog; the state line, card and bar never mention runs.
   The direction claims the page answers "what runs" — it doesn't. Change: a run fact in the state
   line at the `2xs` fact step; the modal stays the gate.
2. **Restart pending shows twice** — two headings 40px apart, two Restart buttons.
3. **In restart-pending the accent is on the wrong control**: the card still renders an enabled
   bronze Install while Restart is outline and the warning is an 11px pill. Change: drop Install
   while `restartRequired`.
4. **The bar's restart mark is the least legible sign on the screen**: `text-warning` in light is
   2.97:1, under 3:1 for a graphic; icon-only at both widths, the words only in the aria-label.
   Change: a darker warning step and a visible word at ≥sm.
5. **The mark wears no accent, and the direction says it should** — but primary on the light bar
   measures 2.2:1, so doing what the doc says would make it fainter. Change: settle it in
   `design.md`, or add a legible accent step; don't just add `text-primary`.
6. **On a phone the check-in is a bare arrow**: 36×44 with the tag hidden; the width is under the
   ladder's own 44. Change: a 44×44 target.
7. **The sentence that says runs stop is the smallest, faintest text on the page** (`2xs` muted,
   the same step as dates). Change: one step up and not muted.
8. **"Installing" has no time base**: a dead apply and a slow one look identical. Change: a moving
   fact — stage, or "last answered 12:04:31" — at `2xs`.
9. **The first seconds lie**: the header prints "dev build" while the state line says the gateway
   has not answered, with two Check now buttons. Change: no build line until `status` exists, and
   one check control.
10. **Phone ladder hole: every Toggle stays 32px** (measured live at 390 and in the stories).
    `design.md` promises one rule with no exceptions. Change: `toggleVariants` takes the step.
11. **Notes print at 16px, against the direction's `base`** — Install sat at y≈1927 on an 844px
    phone, 2.3 screens of prose before the press. Change: pick one — the table or the CSS.

Passing, for the record: muted facts 4.62:1 light / 7.57:1 dark; warning badge 8.58:1; Install
8.65:1 on bronze; no horizontal overflow anywhere; picker rows 47/50px; no motion to fight.

## What changed after round 1

Fixed, with the numbers to prove it (all re-measured in the browser, both themes):

| Finding | What changed |
|---|---|
| The picker's duplicate running row, twice-accented | `runningRow` is cleared once the list holds the current build; the pinned row no longer takes the current-row tint; the row in view takes `bg-primary/10` |
| Two Restart blocks | One: the state line's, with one button |
| Toggles 32px on the phone | `toggle.tsx` takes `max-sm:h-11` (and the Settings tabs `max-sm:h-11`): measured 44 |
| The phone mark 36 wide | A 44×44 square with the 20px arrow: measured 44×44, `text-primary` |
| The phone bar 48px | The 56px step moved into `tokens.css` where the token lives: measured 56 on the phone, 48 on the desktop |
| The inert up-to-date card | Notes only: no backup note, no VM choice, no Install |
| The refusal in the normal voice, the lying caption, two check controls | The refusal is the state line, in the gateway's words; the picker is silent; a state that owns a control gets no second one |
| The in-between notes raw and in the fact tone | Rendered through `Markdown`, in the foreground |
| The notes size | Kept at the renderer's 16px — TINKERER's word — and the direction and the "no notes" sentence now say so |
| The running mark | Mono muted word, not a badge: off the 4.39:1 background and back on the page's 4.62:1 |
| The phone gutter | `Measure padding="lg"`, the same step Settings uses: measured x=16 |
| The stories drawing their own bar | They render the app's bar (`h-(--bar-height) px-1`) |
| Runs were invisible until the modal | A runs fact under the state line at `2xs`: "5 runs are live across acornfall (2), hello-omri (3) · installing asks first" |
| Install still offered while a swap waits | The card drops its cost band and press when `restartRequired`: Restart above is the action |
| The restart mark read 2.97:1 in light | `text-warning-subtle-foreground` — 3.49:1 light, 9.17:1 dark, both over the graphic floor — and the word "Restart" shows at ≥sm |
| The mark's accent was `--primary` | `text-primary-subtle-foreground`: measured 1.48:1 for primary on the light bar, 3.17:1 for this step (9.85:1 dark) |
| "Installing" had no time base | The line carries the last answer's clock, at the fact step, and stops waiting on nothing |
| The first seconds printed "dev build" | No build line before `status` exists, and the gateway-silent state owns the only check control |
| The runs-stopping sentence was the faintest text | One step up, foreground |

Deliberate calls, for the record: the release page's `running` stays a mono word rather than the
rail's bronze dot — that dot is a *run* alive, this word is a *build* that is what is running, and
sharing the colour would say they are the same fact. The in-between list stays full prose rather
than one line each: it is what you read before taking a jump of several versions; if it is too long
in practice, the owner's pass is the place to cut it.
