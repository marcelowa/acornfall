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

## OWNER-OPERATOR

Still running; its raw answer lands in this file when it arrives.

## TINKERER — raw answer

- keep — the two-press start with the provider's own method question ("API key | paste a key" vs
  "Sign in | sign in with the provider", then Anthropic's "Select Anthropic login method: Browser
  login (default) / Copy code login (headless)"), and the Copilot device dialog that puts code +
  Copy code + address + Copy address + Open together on screen (356/356 wide on the phone) because
  the address is short — that block, the blank-field-blocks-Continue gate, and the refusal that
  returns the server's own words with "Try again" and clears the field are the parts to protect.
- cut — the address row as a width driver: a `truncate` that resolves at 1269px inside a 446px
  window is decoration, and Copy/Open/Continue parked at x=1774/1880/1832 (1440) and
  x=1413/1526/1476 (390) cost a 1019–1238px sideways drag; printing the whole OAuth URL
  (client_id, scope, code_challenge) in the dialog buys nothing a Copy button does not.
- confused-by — a dialog that says "copy the code Anthropic shows and paste it here" while showing
  no field and "Finishing sign-in…" at the same time; a Copilot device dialog with no line saying
  it is waiting; an address I can read 63 of 214 characters of, with the ellipsis off-screen; and
  "Copy failed" on every press here, which I cannot lay at the product's door from this box.
- would I keep using this — no for the paths I own: the sign-in dialog is the one screen that must
  not fight me, and here the thing I need is not one move away but one sideways drag away, at both
  widths; I would keep the key path and the Copilot device code, and run every other sign-in in a
  real browser outside the console.

### Its evidence, and what it could not see

- **Bug A** (the owner's defect): `dialog-content` 446/1465 at 1440×900, 356/1594 at 390×844; every
  child laid out at 1417px; Copy/Open/Continue past the viewport; a real click on Copy auto-scrolled
  the dialog 2549px; the instruction lines themselves were cut (64 of 106 characters).
- **Bug B (R3)**: Anthropic → Sign in → Copy code login stuck in "…| Finishing sign-in…" with no
  input in **7 of 18 runs** (no recovery in 8–12s); healthy runs show the paste field.
- **Bug C (R5)**: at 390 the `Open` link measured **37×21** — the only sub-44px control in these
  flows (Copy/Continue/Cancel are 44).
- **Bug D (environment-bound)**: in this sandbox `clipboard-write` is denied and `writeText` throws
  `NotAllowedError`; the button then read "Copy failed" for a clipboard the textarea fallback would
  have filled — it only runs when the API is missing, not when the write is refused.
- It could not see: the soft keyboard (headless), whether a scrollbar is painted, or the "Copied"
  label (Bug D). It cancelled every flow and left nothing listening on 1455/53692.

## What the panel forces (my reading, for the owner)

**Bugs, fixed or mocked now** (unambiguous, no direction question):

1. `1 models` → the count is pluralised. Fixed in the product and in the mock.
2. The search cannot be cleared: the mock gains a clear control, and the direction says so.
3. The order reads by id, not by name (`OpenCode Zen` before `OpenCode Go`): the mock sorts by
   name, and the build step moves the worker's sort to the name it shows.
4. The state line is muted Inter, not mono (R4): the mock renders values in mono `2xs`.
5. **The answer's confirmation cleared a newer question** (TINKERER's bug B, 7 of 18 runs): a
   select is answered, the flow asks for the paste next, and the confirmation of the select landed
   after the paste had arrived — clearing it. The question now goes only when its own answer
   lands (`authFlowAnswered(flow, promptId)`), and the reproduction is 0 of 10 missing fields
   after the fix, 6 of 10 before it.
6. **The `Open` link was 37×21 on a phone** (bug C): it is a `Button`-as-link now, 61×44 at 390.
7. **Copy said "Copy failed" for a refused write** (bug D): the textarea fallback runs when the
   clipboard API throws, not only when it is missing; verified with `writeText` rejecting — the
   button reads "Copied".

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
8. **The address as text or as a label** (TINKERER: it could read 63 of 214 characters, "printing
   the whole OAuth URL buys nothing a Copy button does not"): the mock shows both — today's clipped
   address, and the host as the label ("Sign in at openrouter.ai") with Copy carrying the whole of
   it either way. The owner picks.
