# 03 — The desired journeys (run 4)

Status: **drafted, panel-tested, and rewritten to the owner's calls** (2026-10-15). Panel feedback
is in `04-panel-journeys.md`; the owner took every recommended default, and the journeys below are
the fixed ones. Each journey names the pain it answers (`01-frame.md`), and the markers are the
panel's: `new`, `fights today`, `keep as is`.

What the console fights today, and where:

- the indicator is an arrow with a count of `1` (`workspace-view.tsx:573`) and names no version;
- the screen is a tab inside Settings, with no URL of its own, and the prefs sit in the same card;
- it can install only the release the last check found, though the gateway can list the last twenty
  and install any one of them;
- the runs gate the dialog shows is one workspace's runs (`workspace-view.tsx:508`), while the
  gateway refuses on every started workspace — so the dialog can say idle while a run lives
  elsewhere, and the press comes back a 409;
- "Wait for drain" closes the dialog and queues nothing (`update-section.tsx:289-297`);
- the restart watch gives up after three polls (`update-section.tsx:327`), and a pending restart has
  no control and no sign outside the page;
- the swap writes the version file before the exec (`update.go:1138`), so the running version moves
  ahead of the process: the indicator drops while the old build still answers.

## J16 — Notice a release, and open its page `new` (pains 2, 3, 5)

1. The bar carries the update mark: on a desktop the newest GA's tag beside it, on a phone the mark
   alone. It is there while the newest GA is **newer** than the running build. While a restart is
   pending, the bar carries that too, so the one state that needs the owner is visible without the
   page.
2. Two ways in, both always: press the mark, or Settings → **General** → **Releases**,
   which opens `/update` whether or not a newer release is known. A pasted URL works as well.
3. The page opens on the newest GA, "newest" meaning the newest on the fetched list — the list is
   the truth for newest, the status is the truth for running, and `Check now` refreshes both.
   Reading is free: opening the page installs nothing, and Back returns where the press happened.
4. Before anything is pressed, the page says: the running build, the target tag and its date, what
   changed, the download size, that a backup runs first, and the keep/clean choice for sandboxes —
   the parts that work today stay.

Must be true: the page names the tag it offers in one noun and installs with one verb; it never
offers the running build as a target; it renders from the status the stream already carried and
fills in from the list, so it never opens empty; a `dev` build says "dev build", claims no newer or
older, and keeps the bar clean.

## J17 — Install the release the page names `new` (pain 2)

1. Press **Install**.
2. Runs are active — and the gate is the **gateway's** answer, every started workspace, not the
   workspace in view. The dialog says what stopping would stop (the count and the workspaces) and
   offers: **Not now** (nothing is queued; the press is the owner's to make again), **Stop runs and
   install**, or cancel.
3. The order is the safe one: backup, download, verify, **then** stop runs, wipe sandboxes only on
   Start clean, swap, restart. A failed download costs no runs.
4. The page follows the restart until the gateway answers with the new build; if the gateway stays
   away, the page says it lost it and offers Check again — never a give-up timer. Whoever left the
   page gets the window reloaded when the new build arrives; the page says so before the press, and
   a half-typed draft is not kept (a later item, not this run).
5. Every conversation the install stopped says so where its run was: "stopped by the update".
6. A failure is not a dead page: the old build runs, the page says Rolled back, the cause, and which
   tag failed; Install again is one press, and Roll back sits beside it.

Must be true: the page names the tag it is installing at every step; it never claims the new build
is running before the gateway says so; the restart is shown, not silent.

## J18 — Pick a version `new` (pain 4)

1. The picker lists the last twenty, newest first: tag, date, size, and whether it is a production
   build. The running build is marked. When the running build is older than the window, its row is
   still shown, filled by a by-name read, and the cut is named in words ("from the twenty most
   recent").
2. A switch, **pre-release builds**, widens the list. It is off on a fresh open or reload; it stays
   on while moving between version pages in the session; it refetches the list, and the tag in
   view stays visible in it.
3. Picking a row moves the page to that release's URL (`/update/v0.9.28`): its notes, its size, and
   whether it is newer or older than the running build — an older one says so in words.
4. The notes of every release between the running build and the pick show while the fetched window
   covers them, newest first; when it does not, the target's notes stand alone and the page names
   the cut.
5. Install runs J17's flow, for that tag.
6. Back returns to the release that was open before.

Must be true: picking never installs by itself and never pins; a link to a tag outside the twenty
works, by name; a tag the source does not have says so; a non-production build is marked in the list
and on the page.

## J19 — Refusals, failures, and the restart `keep as is` (the parts that exist, plus one control)

1. No token, no network, an empty list: the page says which, keeps the running build and the last
   known tag, and offers Check now.
2. Restart pending (files swapped, the old process answering): the page says restart pending and
   offers **Restart** — the gateway replaces itself with the binary on disk, same args — and the bar
   shows the restart mark until the new build answers. A manual restart from a shell still works.
3. The last update rolled back: cause, tag, Roll back, Check again.
4. The release published no binary for this machine: the page names the platform.

Must be true: no refusal is a bare status code; each says what happened and what to press next; the
page stays usable when the update tier cannot answer.

## J20 — The phone `new` (pain 6)

1. The bar carries the mark alone; the press opens the release page. The restart mark rides the
   same spot while a restart is pending.
2. The page is one column at 390px: nothing scrolls sideways, tags and notes clamp inside their own
   lines, Install is inside thumb reach, the picker's rows are 44px.
3. Notes scroll the page, not a nested box; Back returns to the conversation with the rail where it
   was.

Must be true: nothing a thumb must hit is under 44px; the runs dialog fits the phone with every
choice legible; the page is one fetch plus one list fetch.

## J21 — Auto-check, and the install-wide page `new` (pain 1)

1. Settings' General page (its Updates section) shows the running build, `auto-check` on or off, and a **Releases**
   row that opens `/update`. The running build and the row are the permanent doors; the bar's mark
   is the shortcut.
2. Toggling saves in one moment and says it saved; the page states the check's own rule (hourly
   while on).
3. Check now lives with the releases, on the release page.

Must be true: `auto-check` is the only update setting left; nothing in settings installs anything;
the old `/settings/updates` address is gone and no link points at it.

## The rules every journey shares

- **R6 — one source per question.** Newest comes from the list, running from the status, and
  anything that runs — the check, the runs gate, the restart — comes from the gateway. The interface
  formats those answers; it never derives a second one.
- **R7 — a version is never shown alone.** Every tag says what it is next to the running build:
  running, newer, or older; and a build that is not a release says so.
- **R8 — nothing long widens anything.** Notes, tags, dates and error text clamp inside their own
  lines at 390px and at 1440px (run 3's R1, carried).
- **R9 — the phone is a real surface.** Every journey runs at 390px with 44px targets, one column,
  and the keyboard untouched (run 2's ladder, carried).
- **R10 — one press, and nothing about it is silent.** No install without a press, ever; the page
  names the tag it installs; the dialog names what stopping runs will stop; the conversations it
  stopped say so; an older pick says it is older.
- **R11 — the page never claims a state the gateway has not answered.** Running, restarting,
  restart pending, rolled back: each is the gateway's word. The page follows until it answers, then
  stops — no timer decides.
- **R12 — one action, one name.** **Install** is the only verb for it, and the bar's control is one
  thing — the update mark — at both widths.
