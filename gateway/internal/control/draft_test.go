package control

import (
	"path/filepath"
	"strings"
	"testing"
)

// A draft is the workspace's, not the browser's: it is written down where the conversations
// are, so the same half-thought waits in the room after a reload and on the other machine.
func TestADraftOutlivesTheProcess(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "drafts.json")
	control := New(Options{Workspace: Workspace{Name: "w", Path: dir}, DraftsPath: path})

	stored, err := control.SetDraft("room", "half a thought", []DraftAttachment{
		{ID: "a1", Name: "shot.png", Size: 12, MIME: "image/png"},
	})
	if err != nil {
		t.Fatalf("save the draft: %v", err)
	}
	if stored.UpdatedAt == 0 {
		t.Error("a saved draft carries a stamp: it is what orders two machines' writes")
	}

	// The room that owns it is the room that shows it.
	state := control.StateFor("room")
	if state.Draft == nil || state.Draft.Text != "half a thought" {
		t.Fatalf("the state should carry the room's draft, got %+v", state.Draft)
	}
	if len(state.Draft.Attachments) != 1 || state.Draft.Attachments[0].ID != "a1" {
		t.Errorf("the staged files ride the draft, got %+v", state.Draft.Attachments)
	}
	if other := control.StateFor("another-room"); other.Draft != nil {
		t.Errorf("a draft belongs to one room, got %+v", other.Draft)
	}

	// A fresh process over the same file is the same room, with the same half-thought.
	reopened := New(Options{Workspace: Workspace{Name: "w", Path: dir}, DraftsPath: path})
	reopened.loadDrafts()
	after := reopened.StateFor("room")
	if after.Draft == nil || after.Draft.Text != "half a thought" {
		t.Fatalf("the draft did not survive the reopen, got %+v", after.Draft)
	}
	if len(after.Draft.Attachments) != 1 || after.Draft.Attachments[0].Name != "shot.png" {
		t.Errorf("the staged files did not survive the reopen, got %+v", after.Draft.Attachments)
	}
}

// A message that was sent is not a draft any more. The entry stays with a fresh stamp rather
// than vanishing, because that stamp is how a machine that still holds the words hears they
// are gone: a delete would leave it with a draft no state event ever contradicts.
func TestASentMessageLeavesAnEmptyDraftWithAFreshStamp(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "drafts.json")
	control := New(Options{Workspace: Workspace{Name: "w", Path: dir}, DraftsPath: path})
	saved, err := control.SetDraft("room", "words about to leave", nil)
	if err != nil {
		t.Fatalf("save the draft: %v", err)
	}

	control.clearDraft("room")

	state := control.StateFor("room")
	if state.Draft == nil {
		t.Fatal("the cleared draft stays as a tombstone, or another machine keeps the words")
	}
	if state.Draft.Text != "" || len(state.Draft.Attachments) != 0 {
		t.Errorf("a sent message leaves nothing to send, got %+v", state.Draft)
	}
	if state.Draft.UpdatedAt < saved.UpdatedAt {
		t.Errorf("the clear must be newer than the words it cleared: %d then, %d now", saved.UpdatedAt, state.Draft.UpdatedAt)
	}

	// And the empty room is not a state a fresh process paints over with the old words.
	reopened := New(Options{Workspace: Workspace{Name: "w", Path: dir}, DraftsPath: path})
	reopened.loadDrafts()
	if after := reopened.StateFor("room"); after.Draft == nil || after.Draft.Text != "" {
		t.Errorf("the clear did not survive the reopen, got %+v", after.Draft)
	}
}

// The state stream carries the draft to every attached client, so a draft with no ceiling
// would make every state event as heavy as the paste that caused it.
func TestAHugeDraftIsRefused(t *testing.T) {
	control := New(Options{Workspace: Workspace{Name: "w", Path: t.TempDir()}})
	if _, err := control.SetDraft("room", strings.Repeat("x", maxDraftBytes+1), nil); err == nil {
		t.Error("a draft past the ceiling is refused rather than stored")
	}
	if _, err := control.SetDraft("", "words with no room", nil); err == nil {
		t.Error("a draft with no conversation is refused")
	}
}
