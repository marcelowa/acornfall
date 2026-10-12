# 09 — Build for real

Date: 2026-08-29. Journey by journey, against the approved mocks in `06-mocks.md` and the
direction in `05-palette.md`. Every mock in `ui/src/mocks/` is now deleted, because every
direction it argued for is in the app.

## What shipped, journey by journey

**J1 / J6 — the rail row.** Spend and when-it-moved sit on the row's second line
(`conversation-row.tsx`), in `2xs` mono, muted and tabular: values you can compare down a column
without hovering, which a phone cannot do at all. `formatMoved` in `lib/format.ts` gives `now`,
`12m`, `3h`, `2d`. A run flagged running whose last move is older than the gateway's own 30-minute
freshness window keeps its dot but loses the accent, so a dead run stops looking alive. The
tooltip keeps the id and the sender.

**J2 — the workspaces screen.** The row wraps: below `sm` the controls drop to their own line
instead of the row running off a phone. The running mark this pass first added was **taken back
out** in the panel round: the wire's `running` for a workspace is its worker process, not a turn
(see `10-panel-look.md`).

**J3 — the transcript cards.** `PaneCard` grew the approved fold: the control moved from the
footer into the header, and a folded card shows its first two lines instead of a 200px window.
The fold thresholds are unchanged (10 lines / 2000 characters — the owner's call), so a
twelve-line output folds and needs a click; the count on the control is what keeps that honest.
Output that was open while a call ran stays open when it settles: the live entry and the settled
one now share the provider's `callId`, which is what React keys the card by
(`entryKey` in `transcript.tsx`), so the component — and the fold — survives the settle.

**J4 — intervening in a live run.** A committed message keeps the mark it was sent with
("steered this turn" / "queued behind the turn"), next to its time. The wire keeps no link
between an inbox item and the entry it becomes, so the app claims it: `use-platform.ts` remembers
what was sent, and hands the mark to the entry that lands with the same words, by entry id, once.
Enter's behaviour is now visible — **Option A** — with a line above the controls while a run is
live: "Enter steers this turn · Shift+Enter is a newline". The two docs that claimed Enter is
always a newline are marked superseded, in place.

**J5 — one commit moment.** The sandbox image commits from its own `Apply` button, not on blur,
and says where it landed: "Applied — takes effect at the next sandbox" under the field, or
`Refused: <the server's words>` beside the value that was refused. The caption no longer has to
explain an exception. The network stays instant.

**Cross-cutting — the phone type ladder.** Below 640px every step up to `base` moves one notch, so
the ladder is 12 / 13 / 14 / 15 / 16 and chrome never reads as content. The transcript body
(`lg`, 16px) is the same at both widths. The old rule bumped `2xs/xs/sm` and left `base` at 14px,
which put `sm` and `base` at the same size.

## What did not ship, and why

- **The thinking card's fold does not survive its settle.** The tool card could be joined by
  `callId`; a thinking block has nothing to join on — the wire gives a message no id, the live
  entry is `live-thinking`, and the settled one is `<entryId>-thinking`. Faking it would mean
  guessing which committed block replaced which live one. The card still folds to two lines with
  its control in the header; it just re-folds when the block commits, and this is the one place
  the mock and the build differ.
- **J2's "land on the latest conversation"** stays a gateway follow-up
  (`control.go` `defaultConversation` prefers the root), as recorded at the step 04 gate.

## Checks

`bun run typecheck`, `bun run lint`, `bun run check:system`, `bun run format:check`, `bun test`
(82 pass, including new cases for `formatMoved` and for a claimed mark), `bun run build:storybook`,
and `make lint` at the root — all green.

`make ui` (the browser suite) was **not** run: it needs a running gateway and a browser, and this
sandbox has neither. The row's markup, the header's fold control and the composer's new line are
the changes most likely to need it, and `data-slot`, `data-status`, `data-live` and
`data-conversation` are all unchanged.

## Stories added for the new states

`Conversation/UserMessage`: Steered, Queued (the marks). `Screens/Settings`: WorkspaceImageRefused.
`Conversation/ConversationRow`: SpendOnTheRow, RunningFresh, RunningStale.

## Verification after the rebase onto origin/main

The branch started from the local tip of `feat-amber-tokens`, which was `origin/main` as of then;
it was not fetched first, and `origin/main` had moved three commits (a control-plane lock fix and
the amber-tokens merge, both Go-only). Rebased onto `origin/main` with no conflicts, 19 commits.

- `make lint` (gofmt, vet, staticcheck, house rules, worker, interface, check-system, format) — clean.
- `make test` (worker units, Go units under `-race`, the feature suite including e2e at 57s) — green.
- `bun run build:storybook`, `bun test` in `ui/` (86) — green.
- `make ui` against a real gateway in this sandbox — **80 passed, 4 failed, twice.** Not flaky: the
  same four, including after a rebuild. The same suite at the commit this branch started from
  (built in a worktree here) fails 11 and passes 69, so the four are not from this work:
  1. "a conversation with content is on screen" — the suite checks the transcript before it has
     sent anything, and a fresh install has no content.
  2. "the line reads agent, model, thinking" and 3. "the panel is the three choices" — the suite
     splits the composer's summary on a spaced separator; the app renders `·` without spaces.
  4. "the drawer carries the rail's own close" — it looks for `aria-label="Hide the rail"` inside
     the drawer's dialog; the sheet's own close button is labelled "Close".
