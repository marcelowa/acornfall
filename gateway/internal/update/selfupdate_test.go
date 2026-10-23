package update

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// selfReleaseServer answers one release by tag with a host binary and a checksum file over sumOver,
// for the asset name in sumName. The three differ per test: the binary, the bytes the sums describe,
// and the name the sums describe.
func selfReleaseServer(t *testing.T, tag string, binary, sumOver []byte, sumName string) *httptest.Server {
	t.Helper()
	if sumName == "" {
		sumName = SelfAssetName()
	}
	sum := sha256.Sum256(sumOver)
	sums := fmt.Sprintf("%s  %s\n", hex.EncodeToString(sum[:]), sumName)
	mux := http.NewServeMux()
	mux.HandleFunc("/releases/tags/"+tag, func(w http.ResponseWriter, r *http.Request) {
		assets := fmt.Sprintf(`{"name":%q,"browser_download_url":%q,"size":%d},{"name":"sha256sums.txt","browser_download_url":%q,"size":%d}`,
			SelfAssetName(), "http://"+r.Host+"/binary", len(binary), "http://"+r.Host+"/sums.txt", len(sums))
		_, _ = w.Write([]byte(releaseJSON(tag, assets)))
	})
	mux.HandleFunc("/binary", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write(binary)
	})
	mux.HandleFunc("/sums.txt", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(sums))
	})
	return httptest.NewServer(mux)
}

// Step 2 fetches a binary and verifies it against the release's own checksum file. A checksum that
// does not match the bytes, or one that describes a different file, is not a binary to put in the
// folder the service runs from.
func TestABinaryThatDoesNotMatchTheReleaseIsRefused(t *testing.T) {
	binary := []byte("the release's binary")
	for _, c := range []struct {
		name    string
		sumOver []byte
		sumName string
		refused string
	}{
		{name: "a checksum for other bytes", sumOver: []byte("some other build"), refused: "does not match"},
		{name: "a checksum for another file", sumOver: binary, sumName: "acornfall-linux-arm64", refused: "does not match"},
	} {
		t.Run(c.name, func(t *testing.T) {
			server := selfReleaseServer(t, "v9.9.9", binary, c.sumOver, c.sumName)
			defer server.Close()
			manager, home := applianceManager(t, server)
			got, err := manager.DownloadSelf(context.Background(), "v9.9.9")
			if err == nil {
				t.Fatalf("want a refusal, got %d bytes", len(got))
			}
			if !strings.Contains(err.Error(), c.refused) {
				t.Errorf("the refusal should say what is wrong: %v", err)
			}
			if _, statErr := os.Stat(filepath.Join(home, "bin")); statErr == nil {
				t.Errorf("a refused binary was written into the owned folder")
			}
		})
	}
	// And the good case, so the refusals mean something.
	server := selfReleaseServer(t, "v9.9.9", binary, binary, "")
	defer server.Close()
	manager, _ := applianceManager(t, server)
	got, err := manager.DownloadSelf(context.Background(), "v9.9.9")
	if err != nil {
		t.Fatal(err)
	}
	if string(got) != string(binary) {
		t.Errorf("the binary is not the release's bytes")
	}
}

// A release with no binary for this host is a sentence, not a retry: step 2 cannot happen and saying
// so once is the whole of what a service should do about it.
func TestAReleaseWithNoBinaryForThisHostSaysSo(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(releaseJSON("v9.9.9", "")))
	}))
	defer server.Close()
	manager, _ := applianceManager(t, server)
	_, err := manager.DownloadSelf(context.Background(), "v9.9.9")
	if !errorsIs(err, ErrNoSelfAsset) {
		t.Fatalf("want ErrNoSelfAsset, got %v", err)
	}
}

// The swap is two phases: the binary under its own name, the marker, then the symlink. The marker is
// what the next process reads when this one cannot start, so it has to be there before the move.
func TestTheMarkerIsWrittenBeforeTheSymlinkMoves(t *testing.T) {
	home := t.TempDir()
	root := t.TempDir()
	if err := SwapSelf(home, root, "v0.10.0-beta.14", []byte("new binary")); err != nil {
		t.Fatal(err)
	}
	attempt, found := ReadBootAttempt(root)
	if !found || attempt.Tag != "v0.10.0-beta.14" || attempt.At == "" {
		t.Fatalf("the marker is what a failed start finds: %+v, %v", attempt, found)
	}
	if attempt.Started {
		t.Error("the swap wrote a marker that is already claimed, so its first start would roll back")
	}
	target, err := os.Readlink(OwnedBinary(home))
	if err != nil {
		t.Fatal(err)
	}
	if target != VersionedBinary(home, "v0.10.0-beta.14") {
		t.Errorf("the symlink points at %q", target)
	}
	info, err := os.Stat(VersionedBinary(home, "v0.10.0-beta.14"))
	if err != nil {
		t.Fatal(err)
	}
	if info.Mode().Perm() != 0o755 {
		t.Errorf("the binary is %v, want 0755", info.Mode().Perm())
	}
	// Reaching ready is what takes the marker away again.
	RemoveBootAttempt(root)
	if _, found := ReadBootAttempt(root); found {
		t.Error("a process that reached ready left the marker behind")
	}
}

// The previous binary stays for a rollback, and only the last two are kept: a folder that grows by a
// binary per release is a leak nobody looks at.
func TestThePreviousBinaryIsKeptAndTheRestGo(t *testing.T) {
	home := t.TempDir()
	root := t.TempDir()
	if err := SwapSelf(home, root, "v0.10.0-beta.13", []byte("thirteen")); err != nil {
		t.Fatal(err)
	}
	// An older one, from before the last two.
	old := VersionedBinary(home, "v0.10.0-beta.12")
	if err := os.WriteFile(old, []byte("twelve"), 0o755); err != nil {
		t.Fatal(err)
	}
	older, err := os.Stat(old)
	if err != nil {
		t.Fatal(err)
	}
	_ = os.Chtimes(old, older.ModTime().Add(-time.Hour), older.ModTime().Add(-time.Hour))
	if err := SwapSelf(home, root, "v0.10.0-beta.14", []byte("fourteen")); err != nil {
		t.Fatal(err)
	}
	previous, err := PreviousBinary(home, "v0.10.0-beta.14")
	if err != nil {
		t.Fatal(err)
	}
	if previous != VersionedBinary(home, "v0.10.0-beta.13") {
		t.Errorf("the previous binary is %q", previous)
	}
	if _, err := os.Stat(old); !os.IsNotExist(err) {
		t.Errorf("a third binary was kept: %v", err)
	}
	// Back to the previous one: the rollback path, without the exit.
	if err := PointAt(home, "v0.10.0-beta.13"); err != nil {
		t.Fatal(err)
	}
	if target, _ := os.Readlink(OwnedBinary(home)); target != previous {
		t.Errorf("the symlink went to %q, want %q", target, previous)
	}
}

// The service replaces only a binary it put there: one started from a package manager's tree serves,
// and says why it will not touch itself.
func TestTheServiceOnlyReplacesItsOwnSymlink(t *testing.T) {
	home := t.TempDir()
	other := filepath.Join(t.TempDir(), "acornfall")
	if err := os.WriteFile(other, []byte("elsewhere"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := SwapSelf(home, t.TempDir(), "v0.10.0-beta.14", []byte("ours")); err != nil {
		t.Fatal(err)
	}
	if !OwnsSelf(OwnedBinary(home), home) {
		t.Error("the owned symlink is the service's own binary")
	}
	if OwnsSelf(other, home) {
		t.Error("a binary outside the install is not the service's to replace")
	}
	// The kernel resolves the link before it execs, so a process started through it reports the file
	// the link named: that is the same binary, and it is ours.
	if !OwnsSelf(filepath.Join(home, "bin", "acornfall-v0.10.0-beta.14"), home) {
		t.Error("the binary the symlink points at is the service's own")
	}
}

// One update at a time per host: the service's automatic step 2 and `machine update` write the same
// binary and the same disk, and two of them at once is a state this design does not have.
func TestTheLockRefusesASecondUpdate(t *testing.T) {
	root := t.TempDir()
	now := time.Date(2026, 10, 22, 10, 0, 0, 0, time.UTC)
	release, note, err := AcquireLock(root, now)
	if err != nil || note != "" {
		t.Fatalf("the first lock: %v %q", err, note)
	}
	if _, _, err := AcquireLock(root, now.Add(time.Second)); err == nil {
		t.Fatal("a second update was let in")
	} else if !strings.Contains(err.Error(), "one update at a time") {
		t.Errorf("the refusal should say what it is: %v", err)
	}
	release()
	if _, _, err := AcquireLock(root, now.Add(2*time.Second)); err != nil {
		t.Errorf("the lock was not released: %v", err)
	}
}

// A lock whose process is alive is held, however long the update is taking: a 195 MB fetch takes
// minutes, and a four-minute-old lock is a working update. Time alone broke a live one.
func TestALiveLockIsNotBroken(t *testing.T) {
	root := t.TempDir()
	now := time.Date(2026, 10, 22, 14, 7, 0, 0, time.UTC)
	if err := os.MkdirAll(filepath.Dir(LockPath(root)), 0o755); err != nil {
		t.Fatal(err)
	}
	// Four minutes in, the pid is this test's and it is very much alive.
	held := now.Add(-4 * time.Minute)
	payload := fmt.Sprintf(`{"pid":%d,"at":%q}`, os.Getpid(), held.Format(time.RFC3339))
	if err := os.WriteFile(LockPath(root), []byte(payload), 0o644); err != nil {
		t.Fatal(err)
	}
	release, note, err := AcquireLock(root, now)
	if err == nil {
		release()
		t.Fatal("a live lock was taken")
	}
	if !strings.Contains(err.Error(), "one update at a time") || !strings.Contains(err.Error(), fmt.Sprint(os.Getpid())) {
		t.Errorf("the refusal should name the holder: %v", err)
	}
	if note != "" {
		t.Errorf("nothing was broken, so there is nothing to say: %q", note)
	}
	if got, readErr := os.ReadFile(LockPath(root)); readErr != nil || string(got) != payload {
		t.Errorf("the held lock was rewritten: %q, %v", got, readErr)
	}
}

// A lock whose process is gone is stale at once: nothing is going to finish what it started.
func TestALockWhoseProcessIsGoneIsBroken(t *testing.T) {
	root := t.TempDir()
	now := time.Date(2026, 10, 22, 14, 7, 0, 0, time.UTC)
	if err := os.MkdirAll(filepath.Dir(LockPath(root)), 0o755); err != nil {
		t.Fatal(err)
	}
	// A pid no process has, one minute old: young enough that age could not be the reason.
	payload := fmt.Sprintf(`{"pid":%d,"at":%q}`, 999999, now.Add(-time.Minute).Format(time.RFC3339))
	if err := os.WriteFile(LockPath(root), []byte(payload), 0o644); err != nil {
		t.Fatal(err)
	}
	release, note, err := AcquireLock(root, now)
	if err != nil {
		t.Fatalf("a dead process's lock should be broken: %v", err)
	}
	defer release()
	if !strings.Contains(note, "stale") {
		t.Errorf("breaking a lock says so: %q", note)
	}
}

// And age is the second condition, for the one thing a pid cannot answer for: reuse. A lock older than
// any update this host does is not believed even when that pid is alive.
func TestALockOlderThanAnyUpdateIsBroken(t *testing.T) {
	root := t.TempDir()
	now := time.Date(2026, 10, 22, 14, 7, 0, 0, time.UTC)
	if err := os.MkdirAll(filepath.Dir(LockPath(root)), 0o755); err != nil {
		t.Fatal(err)
	}
	payload := fmt.Sprintf(`{"pid":%d,"at":%q}`, os.Getpid(), now.Add(-2*lockStale).Format(time.RFC3339))
	if err := os.WriteFile(LockPath(root), []byte(payload), 0o644); err != nil {
		t.Fatal(err)
	}
	release, note, err := AcquireLock(root, now)
	if err != nil {
		t.Fatalf("a lock older than any update should be broken: %v", err)
	}
	defer release()
	if !strings.Contains(note, "stale") {
		t.Errorf("breaking a lock says so: %q", note)
	}
}

// errorsIs keeps the import list honest// errorsIs keeps the import list honest for the one sentinel check above.
func errorsIs(err, target error) bool {
	for err != nil {
		if err == target {
			return true
		}
		unwrapped, ok := err.(interface{ Unwrap() error })
		if !ok {
			return false
		}
		err = unwrapped.Unwrap()
	}
	return false
}
