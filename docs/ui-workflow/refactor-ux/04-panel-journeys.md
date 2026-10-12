# 04 — Panel on the journeys (first pass)

Date: 2026-08-29. One sub-agent per persona from `icp.md` (OWNER-OPERATOR, DELEGATOR, TINKERER),
each given its persona block verbatim, the six journeys, the goal, and the current console. The
app was not run by any of them (no browser in this sandbox); each said so in its own words.

## What the panel converged on

Findings two or three personas hit independently. These are the panel's signal.

1. **Spend is hover-only.** Cost, tokens and id live in the rail row's `title` tooltip
   (`components/conversation/conversation-row.tsx:70`); a phone has no hover, and the inspector
   shows provider tokens, not money. All three personas. The row's own doctrine defends the
   omission ("a 280px rail has room for a title or a column of numbers, not both"), so this is a
   direction to settle in step 06, not a bug.
2. **A message's steer/queued mark dies when it commits.** `action` is set on the pending entry
   (`app/map.ts:447`) and on nothing else; the committed `user` entry (`app/map.ts:305`) has no
   field for it. All three. The journey's success moment — no doubt afterwards about what the
   intervention did — cannot pass as shipped.
3. **The settings commit moment is uneven.** The sandbox image commits on blur, and a caption is
   the only thing carrying the exception; a refused commit shows in the top strip while the typed
   text stays, so a failed change looks applied. OWNER-OPERATOR and TINKERER.
4. **Enter steers silently mid-run.** Enter → `submit()` (`components/composer/composer.tsx:154`)
   → `sendText("steer")` (`app/workspace-view.tsx:233`), and Stop/Steer/Queue replace the send
   icon, so nothing says Enter is still live. DELEGATOR and TINKERER also caught that
   `milestones.md` (M4) and `docs/ui-workflow/06-interaction-report.md` still claim Enter is always
   a newline — a doc/behaviour conflict, not a taste call.
5. **The phone type scale has no visible step between chrome and content.** Verified:
   `styles/globals.css:190-196` shifts `2xs/xs/sm` up one step below 639px while `--text-base`
   stays 14px, so `text-sm` and `text-base` are the same size on a phone. This is pain 4, at its
   root. TINKERER.

## Per journey

**J1 — Resume the right conversation.** Approve with changes, from all three: spend must be
visible without a hover (row, phone), and where the value lives is a step-06 decision.
DELEGATOR adds: the running dot is one 30-minute server flag and the row carries no time, so a
dead run keeps its dot; the row should say when the conversation last moved.

**J2 — Pick up another workspace.** Two different problems. TINKERER: step 1 is really
rail → Workspaces → Open (the rail head holds an icon, not a switcher), and the Workspaces screen
carries `running` in its data (`app/view-models.ts:17`, shown in `workspaces-screen.stories.tsx`)
and never renders it. OWNER-OPERATOR: after Open, the rail still lists the old workspace's
conversations under its old title while the transcript says Loading — a wrong-workspace trap.
DELEGATOR: the switch lands on the root conversation, which is a gateway decision
(`gateway/internal/control/control.go:2582`, `defaultConversation` prefers the root).

**J3 — Read a long, tool-heavy turn.** OWNER-OPERATOR: approve as is. TINKERER: approve with one
change — move Show output / Show less into the card header, since it sits in `PaneFooter` under
the output (`components/transcript/tool-card.tsx:96`), so closing a 300-line card means scrolling
past it. DELEGATOR adds: a card opened during a run collapses when the call settles, because the
live entry is keyed `live-<callId>` (`app/map.ts:149`) and the settled one by the wire entry id
(`app/map.ts:292`), so React remounts it.

**J4 — Intervene in a live run.** All three: keep the three labelled buttons; the journey's "one
choice at a time" wording is wrong (M4 decided against mode state, and the panel agrees with the
shipped choice). The real failure is #2 above. TINKERER: Steer's presence is already honest — it
only appears when the run is steerable.

**J5 — Change a setting once and know it stuck.** Approve with changes. OWNER-OPERATOR: the image
field must show that its commit landed; today a saved value and a typed one look the same.
TINKERER: one commit moment per settings page, drop the blur exception so no caption has to
explain it. Also named as friction, not fixes: five tabs and no search, "theme" absent from the
tab bar, the inspector showing only the latest request, and its Context rows using native
`<details>` (`components/inspector/context-panel.tsx:17`) under sections that use chevron buttons.

**J6 — Check on a run from a phone.** Approve with changes. Keep the drawer, the two-row footer,
the touch Enter rule, the wrapping output. Change: the check-in must answer "is it done, what did
it cost, when did it last move" without a hover (#1 and #5 above).

## Verification status (checked in code, app not run)

Verified: phone type scale, the committed-mark gap, the Submit/Enter path, the tool-card control
placement, the tool-card remount, the workspaces `running` field, the native `<details>`, the
gateway `defaultConversation`, the hover-only spend.

Not verified yet: the rail keeping the old list and title during a switch (OWNER-OPERATOR),
"the inspector shows only the latest request" and "no Escape handler in settings" (TINKERER), and
the image field's exact commit path (both).

## Scope calls for the owner

- **S1 — J2's landing step.** "Land on the latest" is a Go change in the gateway, not UI work.
  Options: accept the gateway change; rewrite J2 to what the UI can own (running marks on the
  Workspaces screen, honest rail and title during a switch); or drop the landing step.
- **S2 — J4's wording.** Rewrite the journey to the shipped shape — three labelled choices, one
  meaning each — and keep the buttons the panel likes. The missing committed mark stays a change.
