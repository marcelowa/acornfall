package update

import (
	"context"
	"errors"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// The channel carries a release tag and nothing else (ADR 0030, decision 3). The table is the
// surface: what the product may ask for, and the shapes that are refused.
func TestWhatCountsAsAReleaseTag(t *testing.T) {
	for _, c := range []struct {
		version string
		want    bool
	}{
		{"v0.10.0-beta.14", true},
		{"v1.2.3", true},
		{"v1.2.3-rc.1", true},
		{"v1.2.3-beta-2", true},
		{"v0.0.1", true},
		{"", false},
		{"v", false},
		{"1.2.3", false},
		{"v1.2", false},
		{"v1.2.3.4", false},
		{"v1.2.x", false},
		{"v1..3", false},
		{"v1.2.3-", false},
		{"v1.2.3-BETA", false},
		{"v1.2.3; rm -rf /", false},
		{"../v1.2.3", false},
		{"v1.2.3/../../etc/passwd", false},
		{"dev", false},
	} {
		if got := IsReleaseVersion(c.version); got != c.want {
			t.Errorf("IsReleaseVersion(%q) = %v, want %v", c.version, got, c.want)
		}
	}
}

// want.json is untrusted: missing, empty and unparsable are "nothing declared yet", and a version
// that is not a release is refused with the sentence the console shows. None of them may be an
// error the service treats as fatal.
func TestTheProductAsksWithAReleaseAndNothingElse(t *testing.T) {
	for _, c := range []struct {
		name    string
		payload string // "" writes no file at all
		want    string
		refused string // a fragment the error must name
	}{
		{name: "no file is nothing declared"},
		{name: "an empty file is nothing declared", payload: "   \n"},
		{name: "a release is the whole vocabulary", payload: `{"version":"v0.10.0-beta.14"}`, want: "v0.10.0-beta.14"},
		{name: "unknown fields are ignored", payload: `{"version":"v1.2.3","command":"rm -rf /","path":"/etc"}`, want: "v1.2.3"},
		{name: "no version is nothing declared", payload: `{"version":"  "}`},
		{name: "not JSON is refused", payload: `{"version":`, refused: "not JSON"},
		{name: "a path is refused by name", payload: `{"version":"../../etc/passwd"}`, want: "../../etc/passwd", refused: "not a release tag"},
		{name: "a shell word is refused by name", payload: `{"version":"v1.2.3; rm -rf /"}`, want: "v1.2.3; rm -rf /", refused: "not a release tag"},
	} {
		t.Run(c.name, func(t *testing.T) {
			root := t.TempDir()
			if c.payload != "" {
				if err := os.MkdirAll(HostDir(root), 0o755); err != nil {
					t.Fatal(err)
				}
				if err := os.WriteFile(WantPath(root), []byte(c.payload), 0o644); err != nil {
					t.Fatal(err)
				}
			}
			want, err := ReadWant(root)
			if c.refused != "" {
				if err == nil || !strings.Contains(err.Error(), c.refused) {
					t.Fatalf("want the refusal to name %q, got %v", c.refused, err)
				}
				if c.want != "" && want.Version != c.want {
					t.Errorf("the refused value reads back as %q, want %q", want.Version, c.want)
				}
				return
			}
			if err != nil {
				t.Fatalf("this is not a failure: %v", err)
			}
			if want.Version != c.want {
				t.Errorf("version = %q, want %q", want.Version, c.want)
			}
		})
	}
}

// Both files are replaced in one step and leave no temporary behind: a reader sees the whole old
// file or the whole new one, and a folder that filled with half-written files is a leak.
func TestTheChannelReplacesItsFilesAndLeavesNoTemporary(t *testing.T) {
	root := t.TempDir()
	if err := WriteWant(root, "v0.10.0-beta.14"); err != nil {
		t.Fatal(err)
	}
	if err := WriteIs(root, HostState{Running: true, Version: "v0.10.0-beta.13", Service: "v0.10.0-beta.13", At: StampedAt(time.Now())}); err != nil {
		t.Fatal(err)
	}
	entries, err := os.ReadDir(HostDir(root))
	if err != nil {
		t.Fatal(err)
	}
	for _, entry := range entries {
		if entry.Name() != "want.json" && entry.Name() != "is.json" {
			t.Errorf("a temporary file was left behind: %s", entry.Name())
		}
	}
	state, ok := ReadIs(root)
	if !ok {
		t.Fatal("is.json should read back")
	}
	if !state.Running || state.Version != "v0.10.0-beta.13" || state.At == "" {
		t.Errorf("state = %+v", state)
	}
	if err := WriteWant(root, "../../etc/passwd"); !errors.Is(err, ErrNotARelease) {
		t.Errorf("the product may not write a path: %v", err)
	}
	if got, _ := ReadWant(root); got.Version != "v0.10.0-beta.14" {
		t.Errorf("a refused write changed the file: %q", got.Version)
	}
}

// is.json is a state, not a promise: a missing, empty or broken file is "the host has not said
// anything yet", and the console draws what it knows instead of failing.
func TestTheHostStateIsToleratedWhenItIsNotThere(t *testing.T) {
	root := t.TempDir()
	if _, ok := ReadIs(root); ok {
		t.Error("no file is no state")
	}
	if err := os.MkdirAll(HostDir(root), 0o755); err != nil {
		t.Fatal(err)
	}
	for _, payload := range []string{"", "   ", "{not json"} {
		if err := os.WriteFile(IsPath(root), []byte(payload), 0o644); err != nil {
			t.Fatal(err)
		}
		if _, ok := ReadIs(root); ok {
			t.Errorf("%q should not read as a state", payload)
		}
	}
}

// The appliance's update is a declaration, not a swap: Apply writes the release it wants into the
// mount and leaves its own binary alone (ADR 0029's rule, ADR 0030's channel).
func TestTheApplianceAsksInsteadOfApplying(t *testing.T) {
	root := t.TempDir()
	home := t.TempDir()
	bin := filepath.Join(home, "acornfall")
	if err := os.WriteFile(bin, []byte("old-binary"), 0o755); err != nil {
		t.Fatal(err)
	}
	manager := New(home, root, bin, "")
	manager.WithLauncherOwner()
	if err := manager.Apply(context.Background(), ApplyOptions{Tag: "v0.10.0-beta.14", Drain: "stop"}); err != nil {
		t.Fatalf("asking the host is not a failure: %v", err)
	}
	want, err := ReadWant(root)
	if err != nil || want.Version != "v0.10.0-beta.14" {
		t.Fatalf("the intent is in the mount: %+v, %v", want, err)
	}
	if body, _ := os.ReadFile(bin); string(body) != "old-binary" {
		t.Errorf("the product patched its own image: %q", body)
	}
	status := manager.Status()
	if status.Wanted != "v0.10.0-beta.14" {
		t.Errorf("the status carries what was asked for, got %q", status.Wanted)
	}
	if status.Host != nil {
		t.Errorf("no host has answered yet, so there is no state: %+v", status.Host)
	}
	if err := manager.Apply(context.Background(), ApplyOptions{Tag: "../../etc/passwd"}); !errors.Is(err, ErrNotARelease) {
		t.Errorf("a path is refused by name: %v", err)
	}
}

// What the host says reaches the console through the state the stream already carries, and a host
// install — where the product updates itself — carries neither field.
func TestTheConsoleSeesWhatTheHostSays(t *testing.T) {
	root := t.TempDir()
	manager := New(t.TempDir(), root, filepath.Join(t.TempDir(), "acornfall"), "")
	if err := WriteWant(root, "v0.10.0-beta.14"); err != nil {
		t.Fatal(err)
	}
	if err := WriteIs(root, HostState{Running: true, Version: "v0.10.0-beta.13", Service: "v0.10.0-beta.13", LastError: "applying v0.10.0-beta.14: no route to the release", At: StampedAt(time.Now())}); err != nil {
		t.Fatal(err)
	}
	status := manager.Status()
	if status.Wanted != "" || status.Host != nil {
		t.Fatalf("a host install has no host channel: %+v", status)
	}

	manager.WithLauncherOwner()
	status = manager.Status()
	if status.Wanted != "v0.10.0-beta.14" {
		t.Errorf("wanted = %q", status.Wanted)
	}
	if status.Host == nil || status.Host.Version != "v0.10.0-beta.13" || status.Host.LastError == "" {
		t.Errorf("host = %+v", status.Host)
	}
}
