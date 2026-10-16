# Drafts

A half-typed message belongs to the room it was written in, not to the page it was typed on.
The workspace holds it, so it is there after a reload, after a switch to another conversation,
and on the other machine. Written 2026-10-16, after the owner asked for a draft that stays put.

## Where a draft lives

`<home>/state/<workspace>/drafts.json`, one file per workspace, beside `settings.json` and
`session.sqlite`. A file of its own, not a field in the settings: a draft changes with every
keystroke and the settings rarely, and one file holding both would rewrite the choices every
time someone typed.

```json
{
  "drafts": {
    "3": {
      "text": "half a thought",
      "attachments": [{ "id": "…", "name": "shot.png", "size": 12000, "mime": "image/png" }],
      "updatedAt": 1760000000000
    }
  }
}
```

The console writes through `POST /api/workspaces/{ws}/conversations/{id}/draft`, and the answer
is what was stored, stamp included. Empty words and no files clear the entry. A cleared entry
*stays*, with a fresh stamp, rather than being deleted: that stamp is how a machine that still
holds the words that were just sent hears they are gone. A delete would leave it holding a
draft that no state event contradicts, and it would send the same message twice.

A draft starts no turn, takes no busy sign, and shows nowhere in the transcript. It is not a
queue: what is queued is the worker's own inbox, and it is visible there.

## Riding the state

The active conversation's draft rides `State.draft`, so every machine and tab watching the room
hears it move — the same signal the rail uses (`publish` → `notifyState`), one state event per
write. The gateway clears the draft when it accepts a prompt, in the same call that turns the
words into a message, so the clearing is announced by the state event the prompt already sends.

The console batches its writes: 400 ms after the last keystroke, plus the moments a page cannot
wait through — the tab going hidden, `pagehide`, the stream coming back, and the workspace
being left. Those last writes go out with `keepalive`, because a reload mid-sentence is the
reload the draft exists for.

One draft may be 64 KB of text. It is refused past that rather than truncated, because a draft
is carried by every state event to every attached client, and a paste with no ceiling would
make every one of them as heavy as the paste.

## The three copies, and which one is on screen

At any moment there are three copies of one draft: the edit this machine just made that may not
have landed, the server's copy from the last state event, and the last value the server took
from this machine. `ui/src/app/draft.ts` decides which one the composer shows, and the order is
the whole rule:

1. **This machine's own edit wins** while it is on its way. The person is typing on this
   keyboard, and the server cannot hold words it has not seen.
2. **The server's copy wins** when its stamp is newer than the last thing this machine wrote or
   read. That is another machine's edit, or the clear that follows a message sent from one.
3. **Otherwise the last write of this machine stays**, because a state event carries the state
   as it was when the event was raised: an echo raised before a save landed is older than the
   save, and letting it win would put older words back on the screen with nothing to correct
   them until the next keystroke.

Two machines typing into one room at once is settled by arrival, last write wins. The console
does not merge and does not lock: the person is one person, and the room's shelf holds one
message.

## Files

A draft's chips are best-effort by design. A file that finished uploading has an id, and the id
is what the draft holds, so the chip comes back ready after a reload or on another machine. A
file still uploading, or one the server refused, is this machine's alone: the server never saw
it, and it does not survive. A draft with files and no words is a message, and is kept as one.

## What is not built

- **A draft per machine.** The room's shelf is one shelf. A console cannot hold a different
  half-sentence than the phone does.
- **A marker in the rail.** A conversation with a draft looks like any other row.
- **Pruning.** A conversation that goes away leaves its draft behind, one entry at most. Sent
  drafts stay as empty entries with their stamps, which is a line or two each.
