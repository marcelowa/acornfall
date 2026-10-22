package update

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// ErrNotARelease is the refusal of a value in the channel that is not a release tag. It is a client
// error — the mount's writer asked for something the channel does not carry — not a server fault
// (ADR 0030, decision 3).
var ErrNotARelease = errors.New("not a release tag")

// The channel between the product and the host service (ADR 0030): declared intent and observed
// state, in two files under the one folder the machine mounts. No ids, no replies, no timeouts —
// repeating an intent is a no-op, and a state is still true after either side restarts. Both are
// written atomically, because a reader that sees half a file is a decision made on garbage, and
// both are read tolerantly, because a channel that fails the console when the host is between
// restarts is worse than no channel.

// HostDir is where the two files live: inside the mount, so the product can write one and read the
// other (ADR 0022's one crossing).
func HostDir(share string) string { return filepath.Join(share, "state", "host") }

// WantPath is the file the product writes: the release it wants to be running.
func WantPath(share string) string { return filepath.Join(HostDir(share), "want.json") }

// IsPath is the file the host service writes: what is running, and the last thing that went wrong.
func IsPath(share string) string { return filepath.Join(HostDir(share), "is.json") }

// Want is the product's declaration. One field: the channel carries a release, and never a path, a
// command, an environment variable or a URL (ADR 0030, decision 3).
type Want struct {
	Version string `json:"version"`
}

// HostState is the host service's observation, as the console reads it: whether the machine is
// running, which release it is, which build of the service supervises it, and what failed last.
type HostState struct {
	Running   bool   `json:"running"`
	Version   string `json:"version"`
	Service   string `json:"service"`
	LastError string `json:"lastError"`
	At        string `json:"at"`
}

// IsReleaseVersion says whether tag names a release: `vX.Y.Z`, and a `-suffix` when the release is
// a beta or a release candidate. It is stricter than "starts with a v" because it validates a
// value the mount's writer can put there, and a value that is not a release has nothing to fetch.
func IsReleaseVersion(tag string) bool {
	if len(tag) < 2 || tag[0] != 'v' {
		return false
	}
	core, suffix, hasSuffix := strings.Cut(tag[1:], "-")
	parts := strings.Split(core, ".")
	if len(parts) != 3 {
		return false
	}
	for _, part := range parts {
		if !allDigits(part) {
			return false
		}
	}
	if !hasSuffix {
		return true
	}
	if suffix == "" {
		return false
	}
	for _, r := range suffix {
		if r >= 'a' && r <= 'z' || r >= '0' && r <= '9' || r == '.' || r == '-' {
			continue
		}
		return false
	}
	return true
}

func allDigits(text string) bool {
	if text == "" {
		return false
	}
	for _, r := range text {
		if r < '0' || r > '9' {
			return false
		}
	}
	return true
}

// ReadWant is the service's read of the product's intent. A missing file and an empty one are
// "nothing declared yet" with no error: the product writes one when it has something to ask for. A
// file that is not JSON, or a version that is not a release, is an error that names what is wrong —
// the service puts that sentence in is.json's lastError and changes nothing, which is the whole of
// the refusal (ADR 0030, decision 3).
func ReadWant(share string) (Want, error) {
	if share == "" {
		return Want{}, nil
	}
	payload, err := os.ReadFile(WantPath(share))
	if err != nil {
		if os.IsNotExist(err) {
			return Want{}, nil
		}
		return Want{}, fmt.Errorf("want.json cannot be read: %w", err)
	}
	if len(strings.TrimSpace(string(payload))) == 0 {
		return Want{}, nil
	}
	var want Want
	if err := json.Unmarshal(payload, &want); err != nil {
		return Want{}, fmt.Errorf("want.json is not JSON: %s", firstLine(err.Error()))
	}
	want.Version = strings.TrimSpace(want.Version)
	if want.Version == "" {
		return Want{}, nil
	}
	if !IsReleaseVersion(want.Version) {
		// The value is returned with the error on purpose: the console shows what was asked for
		// beside the sentence that refused it, and a service that acted on either would be wrong.
		return want, fmt.Errorf("%w: want.json asks for %q, and vX.Y.Z or vX.Y.Z-suffix is all this channel carries", ErrNotARelease, want.Version)
	}
	return want, nil
}

// AskHost declares the release this install wants to be running. It is the appliance's whole update
// path (ADR 0029, ADR 0030): this process cannot replace the machine it runs in, so it asks the
// process that can, and the answer arrives as state the console already reads.
func (m *Manager) AskHost(tag string) error {
	if m.share == "" {
		return fmt.Errorf("update: this install has no mount, so there is no way to ask the host")
	}
	return WriteWant(m.share, tag)
}

// WriteWant declares the release the product wants. It is the product's only way to change the
// machine: a release tag, validated here too, so an install on a host cannot write something the
// service would have to refuse.
func WriteWant(share, version string) error {
	version = strings.TrimSpace(version)
	if version == "" {
		return fmt.Errorf("%w: no version, and the channel carries the release to run", ErrNotARelease)
	}
	if !IsReleaseVersion(version) {
		return fmt.Errorf("%w: %q (vX.Y.Z or vX.Y.Z-suffix)", ErrNotARelease, version)
	}
	payload, err := json.Marshal(Want{Version: version})
	if err != nil {
		return err
	}
	return writeFileAtomic(WantPath(share), append(payload, '\n'))
}

// ReadIs is the product's read of the host's state. A missing file, an empty one and one that does
// not parse are all "the host has not said anything yet": the console draws what it knows and names
// nothing as an error, because the host being between restarts is not the product's failure.
func ReadIs(share string) (HostState, bool) {
	if share == "" {
		return HostState{}, false
	}
	payload, err := os.ReadFile(IsPath(share))
	if err != nil || len(strings.TrimSpace(string(payload))) == 0 {
		return HostState{}, false
	}
	var state HostState
	if err := json.Unmarshal(payload, &state); err != nil {
		return HostState{}, false
	}
	return state, true
}

// WriteIs is the service's write of what it observes, once a tick.
func WriteIs(share string, state HostState) error {
	payload, err := json.Marshal(state)
	if err != nil {
		return err
	}
	return writeFileAtomic(IsPath(share), append(payload, '\n'))
}

// writeFileAtomic replaces path in one step: a temporary file in the same directory, flushed, then
// renamed over. The rename is what makes the read safe — a reader sees the old file or the new one,
// never a line of the first and a line of the second.
func writeFileAtomic(path string, payload []byte) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return fmt.Errorf("cannot make %s: %w", dir, err)
	}
	temp, err := os.CreateTemp(dir, "."+filepath.Base(path)+"-*")
	if err != nil {
		return fmt.Errorf("cannot stage %s: %w", path, err)
	}
	tempPath := temp.Name()
	// A leftover temporary file is a file the next reader never looks at, and one per failed write
	// is a folder that fills with them.
	defer func() { _ = os.Remove(tempPath) }()
	if _, err := temp.Write(payload); err != nil {
		_ = temp.Close()
		return fmt.Errorf("cannot write %s: %w", path, err)
	}
	// Cheap, and the point of the exercise: a rename without a flush is a file whose name is new
	// and whose contents may not be.
	if err := temp.Sync(); err != nil {
		_ = temp.Close()
		return fmt.Errorf("cannot flush %s: %w", path, err)
	}
	if err := temp.Close(); err != nil {
		return fmt.Errorf("cannot write %s: %w", path, err)
	}
	if err := os.Chmod(tempPath, 0o644); err != nil {
		return fmt.Errorf("cannot write %s: %w", path, err)
	}
	return os.Rename(tempPath, path)
}

// firstLine keeps a parse error's message to its first line: the sentence goes into is.json, which a
// person reads, and a wrapped decoder error is three lines of position numbers.
func firstLine(text string) string {
	if before, _, found := strings.Cut(text, "\n"); found {
		return before
	}
	return text
}

// StampedAt is the time the service records in is.json: seconds, UTC, RFC3339. It is a function so a
// test can fix it.
func StampedAt(now time.Time) string { return now.UTC().Format(time.RFC3339) }
