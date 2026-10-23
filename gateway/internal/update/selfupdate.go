package update

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"
	"syscall"
	"time"
)

// The service's own binary, and the two-step update (ADR 0031). Step 1 is the machine; step 2 is this
// process, and it happens only for a release the machine already runs and answers on. The order is the
// safety: a bad release may break the machine, and the host has to still be there to fix it.
//
// The service replaces only a binary it put there: the symlink under the folder the install owns. A
// binary a person or a package manager placed elsewhere is not its to overwrite, and writing one
// anyway is how a package manager's tree is corrupted.

// ErrNoSelfAsset is a release with no binary for this host: not a fault to retry every tick, but a
// sentence that says why step 2 cannot happen.
var ErrNoSelfAsset = errors.New("the release has no binary for this host")

// ErrNotOwned is the refusal to replace a binary this service did not put there.
var ErrNotOwned = errors.New("this process is not started through the install's own symlink")

// OwnedBinary is the path the service must be started through: the symlink the unit files name, and
// the only binary it will replace.
func OwnedBinary(machinery string) string { return filepath.Join(machinery, "bin", "acornfall") }

// VersionedBinary is where one release's binary is kept.
func VersionedBinary(machinery, tag string) string {
	return filepath.Join(machinery, "bin", "acornfall-"+tag)
}

// SelfAssetName is the release asset holding this host's binary.
func SelfAssetName() string { return "acornfall-" + runtime.GOOS + "-" + runtime.GOARCH }

// OwnsSelf reports whether executable is the binary the owned symlink points at. A service started
// from anywhere else serves, and does not update itself.
//
// Both sides are resolved because they have to be: the kernel resolves a symlink before it execs, so
// os.Executable() never reports the link — it reports the file the link named. "Started through the
// symlink" therefore means "is that file", and the refusal this buys is the one that matters: a
// binary in a package manager's tree, or in the user's own path, is not the install's to replace.
func OwnsSelf(executable, machinery string) bool {
	mine, err := filepath.EvalSymlinks(executable)
	if err != nil {
		return false
	}
	owned, err := filepath.EvalSymlinks(OwnedBinary(machinery))
	if err != nil {
		return false
	}
	return mine == owned
}

// DownloadSelf fetches the release's binary for this host and verifies it against the release's own
// checksum file — the same file, and the same comparison, the appliance and the machine are verified
// with (`sumInList`). The name is checked as well as the size of it: two binaries share a release.
func (m *Manager) DownloadSelf(ctx context.Context, tag string) ([]byte, error) {
	release, err := m.releaseFor(ctx, tag)
	if err != nil {
		return nil, err
	}
	asset := AssetFor(release)
	if asset.URL == "" {
		return nil, fmt.Errorf("%w: release %s has no %s", ErrNoSelfAsset, release.Tag, SelfAssetName())
	}
	binary, err := m.download(ctx, asset)
	if err != nil {
		return nil, err
	}
	list, err := m.checksumList(ctx, release)
	if err != nil {
		return nil, err
	}
	if list == "" {
		return nil, fmt.Errorf("releases: release %s publishes no checksum file, so %s cannot be verified", release.Tag, SelfAssetName())
	}
	if !sumInList(list, binary, SelfAssetName()) {
		return nil, fmt.Errorf("releases: %s's checksum file does not match the %s it published", release.Tag, SelfAssetName())
	}
	return binary, nil
}

// SwapSelf is the two-phase swap (ADR 0031): the binary is written under its own name, a marker
// records the attempt, and only then is the symlink moved. A binary that cannot start is found by the
// next process through that marker, and the symlink goes back to the one before it.
func SwapSelf(machinery, share, tag string, binary []byte) error {
	if !IsReleaseVersion(tag) {
		return fmt.Errorf("%w: %q has no binary to keep", ErrNotARelease, tag)
	}
	if err := writeExecutableAtomic(VersionedBinary(machinery, tag), binary); err != nil {
		return err
	}
	if err := WriteBootAttempt(share, BootAttempt{Tag: tag, At: StampedAt(time.Now())}); err != nil {
		return err
	}
	if err := pointSymlink(OwnedBinary(machinery), VersionedBinary(machinery, tag)); err != nil {
		return err
	}
	return pruneBinaries(machinery, tag)
}

// PointAtPath points any link at any target, atomically: the install uses it for the symlink it makes, and
// it is the same move a rollback makes.
func PointAtPath(link, target string) error { return pointSymlink(link, target) }

// PointAt points the owned symlink at the binary for tag, and is what a rollback uses too.
func PointAt(machinery, tag string) error {
	return pointSymlink(OwnedBinary(machinery), VersionedBinary(machinery, tag))
}

// PointsAt says the owned symlink already names tag's binary: another process — `machine update` is
// the one that does — has put this release in place, and the service only has to restart into it.
func PointsAt(machinery, tag string) bool {
	target, err := os.Readlink(OwnedBinary(machinery))
	if err != nil {
		return false
	}
	if !filepath.IsAbs(target) {
		target = filepath.Join(filepath.Dir(OwnedBinary(machinery)), target)
	}
	return filepath.Clean(target) == filepath.Clean(VersionedBinary(machinery, tag))
}

// PreviousBinary is the other binary in the owned folder: the one before tag, and the one a failed
// start goes back to. Empty means there is nothing older to go back to.
func PreviousBinary(machinery, tag string) (string, error) {
	entries, err := os.ReadDir(filepath.Join(machinery, "bin"))
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", err
	}
	type candidate struct {
		path string
		at   time.Time
	}
	var others []candidate
	for _, entry := range entries {
		name := entry.Name()
		if !strings.HasPrefix(name, "acornfall-") || name == "acornfall-"+tag {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		others = append(others, candidate{path: filepath.Join(machinery, "bin", name), at: info.ModTime()})
	}
	if len(others) == 0 {
		return "", nil
	}
	sort.Slice(others, func(a, b int) bool { return others[a].at.After(others[b].at) })
	return others[0].path, nil
}

// PruneBinaries keeps the binary this process runs and the one before it, and removes the rest: a
// folder that grows by one 15 MB binary per release is a slow leak nobody looks at.
func PruneBinaries(machinery, keep string) error { return pruneBinaries(machinery, keep) }

func pruneBinaries(machinery, keep string) error {
	entries, err := os.ReadDir(filepath.Join(machinery, "bin"))
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	type kept struct {
		path string
		at   time.Time
	}
	var binaries []kept
	for _, entry := range entries {
		if !strings.HasPrefix(entry.Name(), "acornfall-") {
			continue
		}
		info, err := entry.Info()
		if err != nil {
			continue
		}
		binaries = append(binaries, kept{path: filepath.Join(machinery, "bin", entry.Name()), at: info.ModTime()})
	}
	sort.Slice(binaries, func(a, b int) bool { return binaries[a].at.After(binaries[b].at) })
	for index, binary := range binaries {
		if index < 2 || binary.path == VersionedBinary(machinery, keep) {
			continue
		}
		if err := os.Remove(binary.path); err != nil && !os.IsNotExist(err) {
			return err
		}
	}
	return nil
}

// writeExecutableAtomic writes the binary beside it and renames it over: a process killed mid-write
// leaves no half binary where the next start would find one.
func writeExecutableAtomic(path string, binary []byte) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("cannot make %s: %w", dir, err)
	}
	temp, err := os.CreateTemp(dir, "."+filepath.Base(path)+"-*")
	if err != nil {
		return fmt.Errorf("cannot stage %s: %w", path, err)
	}
	tempPath := temp.Name()
	defer func() { _ = os.Remove(tempPath) }()
	if _, err := temp.Write(binary); err != nil {
		_ = temp.Close()
		return fmt.Errorf("cannot write %s: %w", path, err)
	}
	if err := temp.Sync(); err != nil {
		_ = temp.Close()
		return fmt.Errorf("cannot flush %s: %w", path, err)
	}
	if err := temp.Close(); err != nil {
		return fmt.Errorf("cannot write %s: %w", path, err)
	}
	if err := os.Chmod(tempPath, 0o755); err != nil {
		return fmt.Errorf("cannot make %s executable: %w", path, err)
	}
	return os.Rename(tempPath, path)
}

// pointSymlink moves a symlink in one step: a new link beside it, renamed over the old one, so a
// reader sees the old target or the new one and never neither.
func pointSymlink(link, target string) error {
	dir := filepath.Dir(link)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("cannot make %s: %w", dir, err)
	}
	temp := filepath.Join(dir, "."+filepath.Base(link)+".new")
	_ = os.Remove(temp)
	if err := os.Symlink(target, temp); err != nil {
		return fmt.Errorf("cannot point %s at %s: %w", link, target, err)
	}
	if err := os.Rename(temp, link); err != nil {
		_ = os.Remove(temp)
		return fmt.Errorf("cannot point %s at %s: %w", link, target, err)
	}
	return nil
}

// BootAttempt is the marker a swap leaves behind: the version it pointed at, and when. The next
// process through this binary is the one that finds it (ADR 0031).
type BootAttempt struct {
	Tag string `json:"tag"`
	At  string `json:"at"`
}

// BootAttemptPath is the marker, in the folder the host's own records live in.
func BootAttemptPath(share string) string {
	return filepath.Join(share, "state", "host", "boot-attempt.json")
}

// WriteBootAttempt records a swap before the symlink moves: the window between the move and the new
// process being ready is the one nothing else can see.
func WriteBootAttempt(share string, attempt BootAttempt) error {
	payload, err := json.Marshal(attempt)
	if err != nil {
		return err
	}
	return writeFileAtomic(BootAttemptPath(share), append(payload, '\n'))
}

// ReadBootAttempt is total like the rest of the host's files: a missing or unreadable marker is no
// marker, and the service starts normally.
func ReadBootAttempt(share string) (BootAttempt, bool) {
	payload, err := os.ReadFile(BootAttemptPath(share))
	if err != nil {
		return BootAttempt{}, false
	}
	var attempt BootAttempt
	if err := json.Unmarshal(payload, &attempt); err != nil || attempt.Tag == "" {
		return BootAttempt{}, false
	}
	return attempt, true
}

// RemoveBootAttempt takes the marker away: a process that reached ready earned it, and a marker that
// was dealt with is not one the next start should find.
func RemoveBootAttempt(share string) { _ = os.Remove(BootAttemptPath(share)) }

// Lock is one update at a time per host: `machine update` and the service's automatic step 2 both
// take it, so two processes never write the same binary or the same disk (ADR 0031).
type Lock struct {
	PID int       `json:"pid"`
	At  time.Time `json:"at"`
}

// LockPath is the lock file, beside the rest of the host's records.
func LockPath(share string) string { return filepath.Join(share, "state", "host", "update.lock") }

// lockStale is the age at which a lock stops being believed even if its pid answers: a pid can be
// reused, and an update three quarters of an hour long is not one this host is still doing. It is the
// second condition and never the first — a 195 MB fetch takes minutes, and an update four minutes in
// is normal, not stale. Time alone broke a live lock once; the process is what decides.
const lockStale = 45 * time.Minute

// AcquireLock takes the one update slot. The second return is a line for the caller's log when it
// broke a lock a dead process left behind, and empty when the lock was free. A live lock is an
// error naming who holds it.
func AcquireLock(share string, now time.Time) (func(), string, error) {
	path := LockPath(share)
	payload, err := json.Marshal(Lock{PID: os.Getpid(), At: now})
	if err != nil {
		return nil, "", err
	}
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return nil, "", fmt.Errorf("cannot make room for %s: %w", path, err)
	}
	note := ""
	for range 2 {
		file, err := os.OpenFile(path, os.O_CREATE|os.O_EXCL|os.O_WRONLY, 0o644)
		if err == nil {
			_, writeErr := file.Write(append(payload, '\n'))
			closeErr := file.Close()
			if writeErr != nil || closeErr != nil {
				_ = os.Remove(path)
				if writeErr != nil {
					return nil, "", writeErr
				}
				return nil, "", closeErr
			}
			return func() { _ = os.Remove(path) }, note, nil
		}
		if !os.IsExist(err) {
			return nil, "", fmt.Errorf("cannot take %s: %w", path, err)
		}
		held, readErr := readLock(path)
		if readErr == nil && !lockStaleFor(held, now) {
			return nil, "", fmt.Errorf("one update at a time: pid %d has been updating since %s (%s)", held.PID, held.At.Format(time.RFC3339), path)
		}
		note = fmt.Sprintf("broke a stale update lock (pid %d, %s)", held.PID, held.At.Format(time.RFC3339))
		if removeErr := os.Remove(path); removeErr != nil && !os.IsNotExist(removeErr) {
			return nil, "", fmt.Errorf("cannot break the stale lock %s: %w", path, removeErr)
		}
	}
	return nil, "", fmt.Errorf("cannot take %s: another process keeps taking it", path)
}

// LockHeld says another process holds the host's update lock. The service asks it before starting a machine: a
// disk that is being replaced must not be booted, and the process replacing it is the one holding the lock.
func LockHeld(share string, now time.Time) bool {
	held, err := readLock(LockPath(share))
	if err != nil {
		return false
	}
	return !lockStaleFor(held, now)
}

func readLock(path string) (Lock, error) {
	payload, err := os.ReadFile(path)
	if err != nil {
		return Lock{}, err
	}
	var held Lock
	if err := json.Unmarshal(payload, &held); err != nil {
		return Lock{}, err
	}
	return held, nil
}

// lockStaleFor says whether a lock may be taken. The process decides first: a lock whose pid is gone is
// stale at once, because nothing is going to finish what it started. Age is the second condition, and
// only for the case a pid cannot answer for — one that was reused between two updates. An update that
// is merely slow is a live lock, and breaking it would let a second update write the same disk.
func lockStaleFor(held Lock, now time.Time) bool {
	if !processAlive(held.PID) {
		return true
	}
	return held.At.IsZero() || now.Sub(held.At) > lockStale
}

func processAlive(pid int) bool {
	if pid <= 0 {
		return false
	}
	process, err := os.FindProcess(pid)
	if err != nil {
		return false
	}
	// Signal 0 asks the kernel whether the process is there without sending anything. A permission
	// error means it is there and belongs to someone else, which is not a stale lock.
	err = process.Signal(syscall.Signal(0))
	if err == nil {
		return true
	}
	return errors.Is(err, os.ErrPermission)
}
