# 03 — The desired journeys (run 3)

Status: **drafted, to be read by the step 04 panel and the owner.** These are the paths through
settings → Providers as they should be, written from the owner's frame (`01-frame.md`: the long
address that scrolls sideways; "general" improvements; copy where it makes sense; both widths).
They are sequences — what the person does, in order — and the rules at the end are the ones every
journey shares. The current console is judged against them in step 04.

## J12 — Read the list, and act on the right provider

1. Open Settings → Providers. The connected providers are first, then the rest by name.
2. Scan one line per row: the name, and the state — connected and how (signed in / key saved),
   where the credential comes from, and how many models it brought; or not connected; or that the
   key lives outside the app.
3. Type into the search to narrow 42 rows to one; clear it in one gesture.
4. Press the row's own action: Add key, Sign in, or Connect when the provider offers both.
5. For a connected row: Disconnect, which asks once (Forget key / Keep) because a deleted key does
   not come back; an ambient-only row says "managed outside" instead of offering a button that
   cannot work.

Must be true: the state is readable without opening anything; the list stays scannable and the
connected stay on top; the action names what it does and never offers a method the provider does
not have; re-check is reachable without scrolling to the bottom of the list.

## J13 — Connect with a key

1. Press Add key. The dialog says where the key will live before it is typed (this install, every
   workspace).
2. Paste the key into the field. Enter submits; the button says Save, then Saving.
3. The dialog says the key worked and the row updates: key saved · where it came from · models.
4. If the key is refused, the refusal is the server's own words and offers Try again.

Must be true: a blank key cannot be sent; the field takes a paste whole (no partial submit); the
answer that landed clears the question instead of leaving a field disabled forever.

## J14 — Sign in with an address, from this machine or another

1. Press Sign in. Where the provider asks how (browser / headless / device code), the choice is
   rendered as the provider's own question, and the answer is one press.
2. The dialog shows the address the person has to reach: the whole address, one line, copyable;
   Open when this machine can finish it.
3. Same machine: the provider's callback completes the sign-in; the dialog moves on by itself. No
   paste is required, and the paste field that was waiting is withdrawn when the provider resolves
   it.
4. Another device (phone, or a console reached remotely): Copy the address, finish the sign-in
   there, and paste the code or the redirect URL back into the field this dialog kept open.
5. A device-code sign-in shows the code and the address, both copyable.
6. While waiting, the dialog says what it waits for — the provider's own line, or the flow's own
   ("Starting…", "Finishing…"), one line, never a pile.
7. Done: the dialog says connected, and the row agrees.

Must be true: the address never widens the dialog or the page at either width, and it is readable;
Copy is one gesture and confirms itself; the paste field is obvious and available for the whole
race; a stray tap outside, or a phone lock, does not end the sign-in; a prompt the provider
resolved itself goes away.

## J15 — Fix or replace a connection that stopped working

1. A key or a sign-in stops working. The list is where that should show, not only a dialog.
2. Re-check is one press: it re-reads the providers and says what it read (or what it could not).
3. Replacing means Forget key (two steps) and connecting again; adding a key for another provider
   does not touch the first.
4. Nothing in this path requires a terminal, an env var edit, or a restart.

Must be true: the honest state is on the row; a refusal says what happened and what to press next.

## The rules every journey shares

- **R1 — nothing long widens anything.** An address, a code, a key, a source path, a provider name,
  an error message: each clips or wraps inside its own line, at 390px and at 1440px. Measured:
  no element in the providers surface may exceed its container's width, and neither the dialog nor
  the page may gain a horizontal scrollbar.
- **R2 — copy where copying is the point.** The address to carry to another device, the code to
  enter, the key to reuse: one gesture, and the control says it copied. A copy button that copies
  nothing useful is noise.
- **R3 — the dialog says what it waits for.** No dead "Starting…", no field that stays disabled
  after its answer landed, no prompt waiting for an answer the provider no longer wants.
- **R4 — facts stay quiet.** Source, model count, state text: `2xs`, muted, mono for values; the
  actions are the only accents on the surface.
- **R5 — the phone is a real surface.** 44px targets below `sm`, fields at 16px, nothing sideways,
  and a dialog that stays above the keyboard when the paste field takes focus.

## What the panel gets

Each persona reads these journeys and the current console (Settings → Providers, and the connect
dialogs), and answers in the run's format: **keep / cut / confused-by / would I keep using this**,
one line each, with the evidence they used. Their raw answers, and the changes they force, go to
`04-panel-journeys.md`.
