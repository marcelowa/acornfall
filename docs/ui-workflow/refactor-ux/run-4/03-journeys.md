# 03 — The desired journeys (run 4)

Status: **drafted, to be read by the owner and then the step 04 panel.** These are the paths through
the release surface as they should be, written from the owner's named pains (`01-frame.md`: the
screen needs a URL of its own, the indicator must name the version, the last releases must be
pickable, and `1` is weird). They are sequences — what the person does, in order — and the rules at
the end are the ones every journey shares. The current console is judged against them in step 04.

What the console fights today, and where:

- the indicator is an arrow with a count of `1` (`workspace-view.tsx:573`) and names no version;
- the screen is a tab inside Settings, with no URL of its own, and the prefs sit in the same card;
- it can install only the release the last check found, though the gateway can list the last twenty
  and install any one of them;
- the prefs (`auto-check`, the pinned tag) are scoped to a tab the owner is removing.

## J16 — Notice a release, and open its page `new` (pain 3, 5)

1. From any screen, the top bar carries the indicator: on a desktop the newest GA's tag beside the
   arrow, on a phone the arrow alone. It is there while the newest GA differs from the running
   build.
2. Press it. The release page opens at its own URL, the newest GA preselected (`/update`).
3. Before anything is pressed, the page says: the running build, the target tag and its date, what
   changed between them, the download size, that a backup runs first, and what the install does to
   sandboxes (the keep/clean choice stays).
4. Reading is free: opening the page installs nothing. Back returns to the screen the press came
   from.

Must be true: the indicator never names the running build; the page renders from the status the
gateway already streamed (running build, target tag, notes) and fills the picker when the list
arrives, so it never opens empty; the press is the same gesture on a phone and a desktop.

## J17 — Install the release the indicator named `new` (pain 2)

1. Press Install.
2. Runs are active: the dialog asks once — Wait for drain / Stop runs and update / Cancel.
3. Idle: it goes — backup, download (the size is on the page), verify, swap, restart.
4. The page follows the restart by itself: Restarting, then the new build answers, and the page
   says the running build is the target. The indicator is gone, because the newest GA is running.
5. A failure is not a dead page: the old build runs, the page says Rolled back, the cause, and
   which tag failed; Install again is one press, and Roll back is beside it.

Must be true: the page names the tag it is installing at every step; it never claims the new build
is running before the gateway says so; the restart is shown, not silent; the backup note and the VM
choice stay as they are today — they are the part that works.

## J18 — Pick a version `new` (pain 4)

1. On the page, open the picker: the last twenty releases, newest first, each row carrying its tag,
   its date, its size, and whether it is a production build. The running build is marked and stays
   visible even when it is older than the window.
2. A switch, "pre-release builds", widens the list for this visit. It is off on every arrival, and
   it is never a stored channel.
3. Picking a row moves the page to that release's URL (`/update/v0.9.28`): its notes, its size, and
   whether it is newer or older than the running build — an older one says so in words.
4. When the pick sits inside the fetched window, the notes of every release between the running
   build and the pick show above the target's own, newest first, so a jump of five versions reads
   as one list of changes. Outside the window, the target's notes stand alone and say so.
5. Install runs J17's flow, for that tag.
6. Back returns to the release page that was open before.

Must be true: picking never installs by itself; picking never pins, and there is no pin field left
to set; a non-production build is marked as one in the list and on the page; a link to a tag the
source does not have says so on the page rather than showing an empty release — and a tag outside
the twenty is fetched by name, so an old link still works.

## J19 — Refusals, failures and the unreachable source `keep as is` (the parts that exist)

1. No token, no network, an empty list: the page says which of them it is, keeps the running build
   and the last known tag, and offers Check now.
2. Restart pending (files swapped, the old process still answering): the page says restart pending,
   Install is off with its reason, and a restart finishes it.
3. The last update rolled back: the cause, the tag, Roll back, Check again.
4. The release published no binary for this machine: the page names the platform, as the gateway's
   refusal does today.

Must be true: no refusal is a bare status code; each says what happened and what to press next; the
page stays usable when the update tier cannot answer.

## J20 — The phone `new` (pain 6)

1. The bar carries the bare dot. Pressing it opens the release page.
2. The page is one column at 390px: nothing scrolls sideways, tags and notes clamp inside their own
   lines (run 3's long-value rule), and the Install button is inside thumb reach.
3. The picker's rows are 44px, the switch is a real control, and the notes scroll the page, not a
   nested box.
4. Back returns to the conversation with the rail where it was.

Must be true: nothing a thumb must hit is under 44px (run 2's ladder); the runs dialog fits the
phone with all three choices legible; the page loads on one fetch plus one list fetch, no more.

## J21 — Auto-check, and what the running build is `new` (pain 1)

1. Settings' install-wide page shows the running build and `auto-check` — on or off — and it is the
   only place either lives.
2. Toggling saves in one moment, and the page says it saved (run 1's one-commit-moment rule).
3. Check now lives with the releases, on the release page, not in settings.

Must be true: the settings page states the schedule in the gateway's own terms (hourly while on);
nothing in settings installs anything; the old `/settings/updates` address is gone, and no link
points at it.

## The rules every journey shares

- **R6 — one source for release state.** The version, the notes, the sizes, the running build and
  the check state come from the gateway's update tier. The interface formats them; it never derives
  a second version truth of its own.
- **R7 — a version is never shown alone.** Every tag on the page, in the picker or in the
  indicator is shown together with whether it is the running build, newer, or older.
- **R8 — nothing long widens anything.** Notes, tags, dates and error text clamp inside their own
  lines at 390px and at 1440px; the page never scrolls sideways (run 3's R1, carried).
- **R9 — the phone is a real surface.** Every journey above runs at 390px with 44px targets, one
  column, and the keyboard untouched (run 2's ladder, carried).
- **R10 — an install is one press, and nothing about it is silent.** No silent pin, no silent
  skip, no silent downgrade: the page names the tag, says when it is older than the running build,
  and shows every step of the update as it happens.
- **R11 — the page never claims a state the gateway has not answered.** Restarting, running,
  rolled back, restart pending — each is the gateway's word, not a guess from the last button
  pressed.
