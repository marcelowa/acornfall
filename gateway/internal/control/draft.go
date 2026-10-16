package control

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"time"

	"github.com/acornfall/acornfall/gateway/internal/protocol"
)

// maxDraftBytes is how many bytes of words one draft may hold. A message is bounded by the
// prompt endpoint; a draft is broadcast with every state event, to every attached client, so
// a draft without a ceiling would make every state event as heavy as the paste that caused
// it. Beyond this the save is refused: the words stay in the composer, which is where they
// were anyway.
const maxDraftBytes = 64 << 10

// Draft is one conversation's unsent message: the words, the files that already staged, and
// when it last moved. It is the console's draft, not a browser's: it lives beside the
// workspace, so the same half-thought waits in the composer on every machine.
//
// A cleared draft stays as an entry with no words and a fresh stamp. The stamp is the point:
// a client that still holds the words that were just sent is told they are gone, because the
// empty draft is newer than the one that client wrote.
type Draft struct {
	Text        string            `json:"text,omitempty"`
	Attachments []DraftAttachment `json:"attachments,omitempty"`
	// UpdatedAt is when the draft last moved, Unix milliseconds, taken by this process. It
	// orders this machine's writes against another's; it is not a wall clock to show.
	UpdatedAt int64 `json:"updatedAt,omitempty"`
}

// DraftAttachment is one staged file riding a draft: the id the message will carry, and what
// the chip over the composer says while it waits. The bytes are the worker's; this is only
// the name for them.
type DraftAttachment struct {
	ID   string `json:"id"`
	Name string `json:"name"`
	Size int64  `json:"size"`
	MIME string `json:"mime"`
}

// persistedDrafts is the file's shape: one map under a key, so the file can grow a field
// without pretending older files were something else.
type persistedDrafts struct {
	Drafts map[string]Draft `json:"drafts,omitempty"`
}

// loadDrafts reads this workspace's drafts. A missing or unreadable file is no drafts, not
// an error: a workspace that never had one is the normal state, and a corrupt one must not
// stop the workspace from opening.
func (c *Control) loadDrafts() {
	if c.opts.DraftsPath == "" {
		return
	}
	payload, err := os.ReadFile(c.opts.DraftsPath)
	if err != nil {
		return
	}
	var stored persistedDrafts
	if err := json.Unmarshal(payload, &stored); err != nil {
		return
	}
	c.mu.Lock()
	defer c.mu.Unlock()
	for id, draft := range stored.Drafts {
		if id == "" {
			continue
		}
		c.drafts[id] = draft
	}
}

// SetDraft records one conversation's unsent message and wakes every attached client, so the
// words show on the machine they were typed on and on the one that has been open all along.
// The newest write wins: two machines typing into one room is a race the server cannot
// untangle, and the last save is the one the person made most recently.
func (c *Control) SetDraft(conversationID, text string, attachments []DraftAttachment) (Draft, error) {
	if conversationID == "" {
		return Draft{}, errors.New("conversation id is required")
	}
	if len(text) > maxDraftBytes {
		return Draft{}, fmt.Errorf("a draft carries %d KB at most", maxDraftBytes>>10)
	}
	kept := make([]DraftAttachment, 0, len(attachments))
	for _, attachment := range attachments {
		if attachment.ID == "" {
			continue
		}
		kept = append(kept, attachment)
	}
	draft := Draft{Text: text, Attachments: kept, UpdatedAt: time.Now().UnixMilli()}

	c.mu.Lock()
	c.drafts[conversationID] = draft
	c.mu.Unlock()

	c.persistDrafts()
	// The state is how a client hears about a draft it did not write: the signal is the same
	// one a settled run uses, and the payload is built fresh per client.
	c.publish(protocol.Frame{Type: "state"})
	return draft, nil
}

// clearDraft empties a room's draft once its message has been accepted. The entry stays with
// a fresh stamp, which is what tells the other machines the words are no longer theirs to
// send — a delete alone would leave them with a draft that no state event contradicts.
func (c *Control) clearDraft(conversationID string) {
	c.mu.RLock()
	current, found := c.drafts[conversationID]
	c.mu.RUnlock()
	if !found || (current.Text == "" && len(current.Attachments) == 0) {
		return
	}
	c.mu.Lock()
	c.drafts[conversationID] = Draft{UpdatedAt: time.Now().UnixMilli()}
	c.mu.Unlock()
	c.persistDrafts()
}

// persistDrafts writes every draft this workspace holds. One file per workspace, because a
// conversation id means something only inside one; the whole file is rewritten, because a
// draft is a handful of bytes and a partial update would be more code than it saves.
func (c *Control) persistDrafts() {
	if c.opts.DraftsPath == "" {
		return
	}
	c.mu.RLock()
	drafts := make(map[string]Draft, len(c.drafts))
	for id, draft := range c.drafts {
		drafts[id] = draft
	}
	c.mu.RUnlock()

	payload, err := json.MarshalIndent(persistedDrafts{Drafts: drafts}, "", "  ")
	if err != nil {
		return
	}
	temp := c.opts.DraftsPath + ".tmp"
	if err := os.WriteFile(temp, append(payload, '\n'), 0o600); err != nil {
		return
	}
	_ = os.Rename(temp, c.opts.DraftsPath)
}
