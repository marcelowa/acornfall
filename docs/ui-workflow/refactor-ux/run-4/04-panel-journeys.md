# 04 — Panel on the journeys (run 4)

Date: 2026-10-15. Three sub-agents, one per persona from `icp.md`, each handed its persona block
verbatim, the journeys (`03-journeys.md`), the frame and goal, and the current release surface to
judge against. They were told not to soften. Their words are below, unedited.

Status: **1 of 3 landed** — OWNER-OPERATOR answered; DELEGATOR and TINKERER are running.

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
