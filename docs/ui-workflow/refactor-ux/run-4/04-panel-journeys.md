# 04 — Panel on the journeys (run 4)

Date: 2026-10-15. Three sub-agents, one per persona from `icp.md`, each handed its persona block
verbatim, the journeys (`03-journeys.md`), the frame and goal, and the current release surface to
judge against. They were told not to soften. Their words are below, unedited.

Status: **3 of 3 landed** — OWNER-OPERATOR, TINKERER and DELEGATOR answered.

## PERSONA: OWNER-OPERATOR

- **keep** — the release page with its own URL, the last twenty on it with tag/date/size/production,
  pick-never-installs, no pin, Back to the screen I came from; and the runs-active dialog and VM
  keep/clean choice surviving untouched — those are the parts I already trust.
- **cut** — the `1` badge, `/settings/updates`, the one card that mixes install with
  channel/auto-check/pin — and "Wait for drain" until somebody writes down what it does after I
  press it.
- **confused-by** — "off on every arrival" (is the pick an arrival?), "the only place either lives"
  (J16.3 and J17.4 put the running build on the release page, so it isn't), and "a restart finishes
  it" (with what — my thumb on what?).
- **would I keep using this** — yes, once the way in when nothing is available is answered and the
  install choices stop being silent; as written I would still open a terminal on a quiet day to
  check for a release, which is the one habit this pass exists to kill.

### Findings

1. **No door to the release page when I am up to date.** J16.1 makes the indicator disappear when
   the newest GA is running; J21.3 moves Check now onto the release page; J21 gives settings'
   install-wide page the running build and auto-check but never says it links to `/update`. So after
   I read a release post at 14:02 with the hourly check at 14:45, how do I check now — or go pick an
   older build — without typing a URL? The frame says Settings is "only a way in" (answer 2), so I
   want J21 to say the settings page opens the release page, or to say plainly that it doesn't. I
   cannot see this answered anywhere, and I'm not guessing.
2. **"Wait for drain" has no stated outcome.** J17.2 lists three choices and stops. Today that
   button closes the dialog and drops me back into the conversation (`onLater` →
   `showScreen("conversation")`); nothing tells me whether the update then fires on its own when the
   runs finish, or waits for me to press Install again. If it fires on its own mid-turn, that is the
   interruption that costs more than the task — and R10's "nothing silent" can't hold until it's
   written. Change: one sentence per choice, in J17, saying what happens, where I land, and whether
   anything later happens without me.
3. **A pending restart names no control.** J19.2 says "a restart finishes it"; the current console
   shows a Restarting badge and re-reads the status on three timers (5s/12s/25s) with no button at
   all. Who finishes it — the gateway, when? If the honest answer is "restart the gateway from a
   shell", the goal is already broken and J19 should admit it. Change: name the control on the page
   that finishes a pending restart, or state the automatic rule.
4. **"Resets each visit" is undefined exactly where it hurts.** J18.2 is off "on every arrival";
   J18.3 says picking navigates to `/update/v0.9.28`. If that arrival resets the switch, then
   pressing Back to `/update` hides the pre-release I just picked, and the list I used is not the
   list I return to — I lose my place, which is churn trigger one for me. J18.1 only promises the
   running build stays visible outside the window. Change: define "visit" once (arrival at
   `/update` only, or the whole release-page session), and keep the chosen tag in the list while its
   page is open.
5. **J21.1 fights J16.3.** "Settings … is the only place either lives" cannot be true of the running
   build when J16.3 ("the page says the running build") and J17.4 ("the page says the running build
   is the target") both show it on the release page. Change: say the running build shows on the
   release page and in settings; "only place" applies to auto-check. Small wording, but I read
   journeys literally, and two homes for one truth is how version confusion starts.
6. **One action, two names.** J16.3 says "what the install does", J17.1 says "Press Install", J18.5
   says "Install runs J17's flow" — the card I have today says "Update now". I have to learn one
   control, not two. Change: settle the verb (Install or Update now) and use it everywhere, journey
   and card. Same for the indicator: J16.1 says "the arrow alone", J20.1 says "the bare dot", the
   frame says dot — give it one noun so I know what I'm pressing on the phone.
7. **"Follows the restart by itself" needs a stopping rule that isn't a timer count.** The current
   restart watch stops polling after three delays; if the restart outlasts them, I sit on a stale
   "Restarting". R11 already promises the page only claims what the gateway answered — J17.4 should
   say the page keeps following until the gateway answers, not for N polls.

## PERSONA: TINKERER

- **keep** — the pin dying and the prefs leaving the release card: today `update-section.tsx` has
  three commit models in one card (auto-check saves on toggle, pinned saves on blur/Enter, keep/clean
  applies at install) and `setUpdatePrefs` posts the whole object; one install-wide page with
  auto-check alone is the one thing in this draft I'd trust on sight.
- **cut** — "Wait for drain" as a third answer in the runs dialog (J17.2): with the gateway I can
  read, that press either does nothing or is refused — it cannot mean what the word says.
- **confused-by** — which read is "the newest" on the page, and whether "the last twenty" contains
  my running build: the page preselects the newest GA from the status the check found while the
  picker is a fresh fetch, and J18.1 promises a running row I cannot see the data for.
- **would I keep using this** — for the page itself, yes; for reaching it, no. The dot is the only
  in-app door and it is conditional. With auto-check off, my own setting, this whole surface is a
  URL I have to remember — which is the terminal with extra steps.

### Findings

1. **No permanent door to the page.** J16.1 opens the dot only while the newest GA differs; J21.1
   gives the settings install page the running build and auto-check and nothing else; J21.3 moves
   Check now onto the release page. `workspace-view.tsx:575-586` confirms the dot is the only in-app
   entrance, and it exists only when `available`. Frame answer 4 counted Settings as an entrance;
   the journeys never give it a link. Worse: the hourly check only runs when auto-check is on
   (`gateway/internal/update/update.go` StartLoop), so with auto-check off the page is reachable by
   typed URL alone — exactly when I'd want to pick a version by hand. Change: one permanent line on
   the install-wide settings page ("Releases — pick a version"), then drop or soften J21.1's "the
   only place either lives".
2. **"Wait for drain" is a lie in the current gateway.** `gateway/internal/update/update.go:833-834`:
   runs active and drain != "stop" returns `ErrRunsActive` — there is no deferred apply. The
   console's middle choice calls `onLater()` (`update-section.tsx:291-294`), i.e. it closes the
   screen and nothing happens when the runs end. J17.2 offers it as a real meaning among three and
   J17.3 never says what follows. Change: either the gateway queues the apply and the page says
   "queued — it starts when the runs drain", or the dialog says "Not now" and stops pretending.
3. **Three version truths on one screen; the journeys don't rank them.** The status
   (current/latest/notes) comes from the last check; the list is fetched fresh with no cache (the
   gateway's own `List` comment says a stale picker is worse than a wait); the URL names a third
   tag. J16.2 says the page opens with "the newest GA" preselected — from which read? An hour-old
   check plus a minute-old list gives two different answers, and R6 doesn't settle it because both
   come from the tier. Change: one sentence — on this page the list is the truth for "newest", the
   status is the truth for "running", and say whether Check now refetches both.
4. **The running row is the one row the data can't fill.** List rows carry
   tag/name/notes/publishedAt/prerelease/sizes (`httpapi/update.go` `wireRelease`); the status
   carries `current` with no date, size or prerelease flag (`client.ts` `UpdateStatus`, ~322-337).
   J18.1 wants the running build marked and staying visible when it is older than the window —
   spliced from the status, that row loses its date and size. J18.4 wants "the notes of every
   release between the running build and the pick": if my running build sits below the cut, those
   releases were never fetched. J18.4 covers a pick outside the window; it does not cover the
   running build outside it. Change: say what the page prints when the range is cut ("from the
   twenty most recent; older changes are not listed") and where the running row's date and size
   come from.
5. **"dev" and unknown tags have no stated treatment.** The gateway sets current to `dev` when
   there is no version file and no stamped build version, and forces `available` false for it
   (`update.go:313`, `356-364`) — so on a box built from source the dot never appears and the picker
   must still say newer/older against a string that isn't a version. R7 and J17/J18 assume a
   comparable tag. Change: one line on what the running line and row markers show for a build that
   is not a release tag.
6. **The indicator's rule is "differs", the goal's promise is "newer".** J16.1 says the dot is
   there "while the newest GA differs from the running build"; the gateway implements exactly that
   (`available = latest.Tag != current`). Install an rc from the picker — the switch exists for it —
   and the bar comes back naming the older GA, with a bare dot on a phone and no words anywhere (R7
   has nowhere to put "older" beside a dot). Change: either `available` means "latest is newer than
   current", or the phone dot and the page's landing line both say the newest GA is older than what
   runs.
7. **"This visit" is undefined exactly where I use it.** J18.2 resets the switch on every arrival;
   J18.3 picking navigates to `/update/v0.9.28`; J18.6 makes Back return to the open page. Is a tag
   navigation an arrival? If so, Back gives me the GA-only list and my pick may be outside it. And
   because the gateway filters pre-releases server-side (`updateReleases` reads the `prerelease`
   query), "widens the list" is a refetch, not a filter — the rows change under my finger. Change:
   define "visit" as first load and fresh open, not in-page tag navigation, and say the switch
   refetches.
8. **The restart follow gives up after 25 seconds with nothing on screen.** `update-section.tsx:327`
   fires three fixed timers (5/12/25s) and then never re-reads. J17.4 wants the page to follow the
   restart by itself and R11 wants the state to be the gateway's word; a slower or failed takeover
   leaves the page on its last word forever, with no "still waiting" and no press to re-read.
   Change: the page keeps following while restarting, or says it lost the gateway and offers Check
   again.
9. **Cannot see / no read found:** a tag page outside the twenty needs a by-name read (J18,
   must-be-true), and the only by-name fetch I can find is `releaseFor` inside Apply
   (`gateway/internal/update/worker.go:269`) — there is no GET for a single tag, only
   `GET /api/update/releases` with a `limit` (cap 100). A link to an old tag therefore has one fetch
   path I can see, and it isn't enough. Also cannot see: where the release page gets the list (no UI
   code for it yet) or how it marks a target the list doesn't contain. Where the page's "switch
   resets" is enforced I cannot tell from journeys alone.
10. **Small churn notes, not blockers.** `settings-screen.tsx:73-75` already prints "acornfall
    {version}" under the Settings heading, so J21.1's "only place either lives" contradicts the
    console. And removing `/settings/updates` with no redirect means an old link in my notes lands
    silently on Defaults (`use-platform.ts:102-105` falls back to "defaults") with no "the page
    moved" — the owner chose no redirect, so I only note that I'd think my link was wrong, not that
    the page moved.

## PERSONA: DELEGATOR

- **keep** — The dot/tag in the bar on every screen, reading free, Back free, and a check that
  never installs: that is a check-in I can do in two seconds from wherever I am.
- **cut** — "Wait for drain". As written it is "Later" wearing a promise it does not keep — cut the
  word or make it wait.
- **confused-by** — Who runs the show: "runs are active" is decided from the workspace I happen to
  be looking at, while the gateway counts every workspace; and when a restart sticks, someone
  "restarts" — I cannot find that control anywhere.
- **would I keep using this** — Yes to read and to check. I would press Install only after I have
  deliberately emptied the shop, and I would still keep a terminal command in my notes for the
  stuck cases — so "no terminal" is not met for me yet.

### Findings

1. **The dialog's "runs are active" is not the gateway's runs.** J17 step 2 treats it as a known
   fact. The console computes it from the conversations of the workspace in view
   (`workspace-view.tsx:508`), the gateway refuses when any conversation in any started workspace
   runs (`Workspaces.AnyRunning`, `workspaces.go:543-549`). With a run alive in another workspace
   the dialog never opens, the press goes out with drain `"wait"`, and the answer is a 409
   `ErrRunsActive` (`update/update.go:165-169`) as an error strip in the gateway's words. That is a
   busy signal that lies in the worst direction — it says idle while my other thread is running.
   Change: J17 must say the gate is the gateway's own answer, and R6 must cover "is anything
   running", not only the release state. Bonus: the gateway's gate has the same 30-minute window
   the rail dims at (`lib/clock.ts`), so a "running" conversation can read as stale in the rail —
   the dialog should say the age, or the two must not disagree.
2. **"Stop runs and update" is an unnamed nuke.** `AbortAll` aborts every running conversation in
   every started workspace (`workspaces.go:528-541`); J17's dialog names nothing — no count, no
   workspaces, no conversations. I run five threads and delegate; that button can kill all of them
   sight unseen. Change: the dialog names what it stops (at least count and workspaces, ideally
   conversation titles), and R10's "nothing about it is silent" gets a runs clause.
3. **"Wait for drain" does not wait — today it is literally "Later".** The button closes the dialog
   and calls `onLater()` → `showScreen("conversation")` (`update-section.tsx:289-297`,
   `workspace-view.tsx:515`). Nothing queues, watches, or tells me when the last run ends. The
   journey kept the label without fixing the meaning. Change: either it queues — the apply fires
   when the last run drains, and the page says it is queued and when it went — or rename it "Not
   now" and say the press is mine to re-make. Keep the word "Wait" only if it waits.
4. **A stuck restart ends in a terminal, and has no sign outside the page.** J19 step 2 says "a
   restart finishes it". The API is status/check/releases/apply/rollback/settings
   (`httpapi/server.go:88-93`) — no restart control; the gateway's own comment says a failed
   self-exec means "a human restarts instead" (`update/update.go:1189-1195`). Worse for check-ins:
   the swap sets `current` to the new tag before the exec (`update.go:1142`), so `available` goes
   false and the bar indicator disappears (J16 step 1) while the old process is still answering.
   The only "restart pending" sign is on a page I now have no reason to visit. Change: J19 must
   name how a restart is finished from the console, and restart-pending must be visible from the
   bar — it is the thing I scan.
5. **With no dot, I cannot get in — so "Check now" is unreachable.** J21 puts the running build and
   auto-check in settings and Check now on the release page, and never says the doorway between
   them. The entry points were "Indicator, a pasted URL, Settings" (`01-frame.md`), but the button
   only exists when a newer GA is already known. Change: name the link from the install-wide
   settings page into the release page, or the one control that finds releases I do not know about
   yet is behind a dot that shows only when I already know.
6. **The stopped runs have no other side.** After "Stop runs and update", J16-J21 say nothing about
   the conversations that were killed: no journey says the rail or the conversation marks "stopped
   by the update", so I cannot tell an update-killed run from a finished one. I looked for
   something in the console and could not find one — say so rather than me guessing. Change: one
   line in J17 and R10 — each conversation the install stopped says so where its run was, so a
   check-in does not require opening the transcript.
7. **The restart will find me wherever I went.** J16 step 4 makes Back free; J17 step 4 shows the
   restart only to someone still on the release page. The console reloads the whole window when the
   stream's build changes (`use-platform.ts:1037-1042`), which the swap causes before the exec. If I
   installed and went back to type, that reload lands mid-sentence; the draft is the composer's own
   state (`workspace-view.tsx:68`), and I cannot see anything that keeps it. Change: J17 must say
   where the restart lands for someone who left — hold the reader until it finishes, or come back
   where they were and say so.
8. **My runs die before the update is known good.** The gateway stops runs first, then backs up,
   downloads, verifies (`update/update.go:869-880`). A failed download costs my five threads and
   buys me a rolled-back update. J17 step 3's sequence does not say when the stop lands. Change:
   name the moment in J17 and say why; if the only reason is quiet, stop after verify, just before
   the swap.
9. **One thing I want signed, not just kept:** nothing installs itself. Auto-check only checks
   (`StartLoop` → `Check`), apply is button-only (`httpapi/server.go:91`), J21 keeps an install out
   of settings, and the pin is gone so nothing can silence the indicator. Put that in R10 as a
   negative line — "no install without a press, ever" — because it is the one promise I am
   counting on.
