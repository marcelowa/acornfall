# 04 — Panel on the journeys (run 3)

Status: **in flight.** Three reviewers (the same personas as runs 1 and 2) drove the running
console at `127.0.0.1:7799` — Settings → Providers, the connect dialogs — against
`03-journeys.md`, and answered in the run's format. Raw answers below, unedited; the changes they
force are collected at the end.

The console they reviewed is the dev install: 43 rows (the real 42-provider catalogue plus the dev
provider `faux`, which is connected because the dev provider always is). That is a sandbox
artifact, not a product state, and it is worth naming: no real install shows `faux`.

## DELEGATOR — raw answer

- keep — Connected rows do lead (`faux` is row 1), each row is one name + one state line + one
  action (Add key ×33, Connect ×8, Sign in ×1, Disconnect ×1), `openai` narrows to 2 rows in under
  a second, `bedrock`/`anthropic` find theirs, nothing overflows sideways at 390 or 1440, phone
  rows are 56px with 44px buttons and a 16px search field, and the Re-check footnote ("Added a key
  outside the app? Re-check reads it.") does say what the button reads.
- cut — Re-check: 1,650px of scrolling on desktop, 2,130px on phone to reach a button that then
  changes nothing any person can see (POST returns 200, page is byte-identical afterwards); a
  check-in control whose entire answer is silence costs a full scroll and gives nothing.
  "Connected · key saved · 1 models" — the one connected row on screen reads wrong. Search that
  cannot be cleared in one gesture (no X, Escape does nothing) costs a backspace-per-character
  every time.
- confused-by — Typing "claude" returns "No provider matches" while Anthropic sits six rows away,
  and "aws" finds nothing while Amazon Bedrock exists — I think in model names, the list thinks in
  catalogue names, and nothing bridges them. "Not connected" could mean never connected or quietly
  stopped working and I cannot tell which, and no row, header or footnote anywhere says when a
  provider was last read — so I cannot tell if the one thing I'm here to catch is even being
  looked at. After pressing Re-check I genuinely do not know whether it did anything.
- would I keep using this — To connect a provider once, yes. As my check-in surface for "is a run
  about to be stopped by a dead key", no: a stopped provider is not representable here (only
  `authenticated: true/false`; no error or last-checked state exists in the UI or the wire), and
  the one re-read control is both buried and mute, so a check-in costs a lot and teaches me
  nothing. Keep this shape only if Re-check moves to the top with a visible result ("read n
  providers, seconds ago") and a dead connection gets its own row state; otherwise I will stop
  checking it and find out via a failed run — the exact late discovery I came to avoid.

### Its evidence

- Scan cost and ordering: 43 rows (1 connected, 42 not); first paint shows **11 of 43** at
  1440×900, **8 of 43** at 390×844; no count of connected anywhere; one `localeCompare` violation
  in the 42 — `OpenCode Zen` before `OpenCode Go`.
- Search: `openai` → 2 rows; `claude` → 0 + "No provider matches."; `aws` → 0; `bedrock` → 1;
  `anthropic` → 1. The input has no clear control in the DOM and Escape leaves the value.
- Re-check: at y=2517 of an 852px viewport (desktop), y=2927 of 796px (phone); pressing it returns
  one 200 POST, the label never changes, no live region, no toast, body text byte-identical at
  100/400/900/1600/2500/3500ms.
- Broken providers: it could not observe one and proved the surface cannot show one — neither
  `ProviderSummary` nor `ProviderInfo` carries an error, an expiry or a last-checked time.
- Phone: page 390/390, settings screen 390/390, no row with internal overflow, all 43 action
  buttons 44px, search font 16px, row height 56px, nothing truncated at either width.
- Bugs, with reproduction: (1) Re-check silent and buried; (2) `1 models`; (3) search misses
  product names and cannot be cleared; (4) OpenCode Zen before OpenCode Go; (5) the state line is
  Inter 11px/12px, muted but not mono, so values are not set apart (R4).

## OWNER-OPERATOR and TINKERER

Still running; their raw answers land in this file when they arrive.

## What the panel forces (my reading, for the owner)

**Bugs, fixed or mocked now** (unambiguous, no direction question):

1. `1 models` → the count is pluralised. Fixed in the product and in the mock.
2. The search cannot be cleared: the mock gains a clear control, and the direction says so.
3. The order reads by id, not by name (`OpenCode Zen` before `OpenCode Go`): the mock sorts by
   name, and the build step moves the worker's sort to the name it shows.
4. The state line is muted Inter, not mono (R4): the mock renders values in mono `2xs`.

**Direction questions the panel puts to the owner** (mocked, not decided):

5. **Re-check, visible and reachable**: beside the search, and after a press the section says what
   it read ("Read 43 providers just now"). Without that, the persona stops checking — and J15's
   whole point is the check-in.
6. **A dead connection must be representable**: a stored credential whose auth check fails is a
   different state from never connected, and today the wire cannot say it. The mock shows the row
   ("Not working · key stored" with Reconnect) as the direction; making it real needs one field
   from the worker (`stored`, with `authenticated: false`).
7. **Model names are how the person thinks** ("claude", "aws"): bridging that is either a hint in
   the empty search state ("try the provider's name — anthropic") or real data (the worker's known
   models per provider). The first is copy; the second is a platform change and this run's
   guardrails say no new capabilities — so the recommendation is the hint now, the data later.
