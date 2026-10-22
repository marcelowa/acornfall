package update

import (
	"strings"
	"testing"
)

// A command whose job is "update me" cannot read `/releases/latest`: it excludes pre-releases, and
// this project ships nothing but betas, so the newest release in the list is the one to take.
func TestTheNewestReleaseIncludesPreReleases(t *testing.T) {
	releases := []Release{{Tag: "v0.9.38"}, {Tag: "v0.10.0-beta.15"}}
	target, err := UpdateTarget("", releases, "v0.9.38")
	if err != nil {
		t.Fatal(err)
	}
	if target != "v0.10.0-beta.15" {
		t.Errorf("the update moves to %q, want the beta", target)
	}
	if newest, ok := NewestRelease(releases); !ok || newest.Tag != "v0.10.0-beta.15" {
		t.Errorf("newest = %+v, %v", newest, ok)
	}
}

// Versions, not text: "v0.10.0-beta.15" sorts before "v0.9.38" as a string and after it as a version,
// and v0.9.10 is newer than v0.9.9 — the two traps a sort by name falls into.
func TestTheNewestReleaseIsComparedAsAVersionNotAsAString(t *testing.T) {
	for _, c := range []struct {
		name     string
		releases []string
		want     string
	}{
		{name: "major ten over major nine", releases: []string{"v0.9.38", "v0.10.0-beta.15"}, want: "v0.10.0-beta.15"},
		{name: "a minor ten over a minor nine", releases: []string{"v0.9.9", "v0.9.10"}, want: "v0.9.10"},
		{name: "a release over its own candidate", releases: []string{"v0.10.0-rc.1", "v0.10.0"}, want: "v0.10.0"},
		{name: "the list order is not the answer", releases: []string{"v0.10.0-beta.15", "v0.9.38", "v0.11.0-beta.1"}, want: "v0.11.0-beta.1"},
	} {
		t.Run(c.name, func(t *testing.T) {
			releases := make([]Release, 0, len(c.releases))
			for _, tag := range c.releases {
				releases = append(releases, Release{Tag: tag})
			}
			newest, ok := NewestRelease(releases)
			if !ok || newest.Tag != c.want {
				t.Errorf("newest = %q (%v), want %q", newest.Tag, ok, c.want)
			}
		})
	}
	if _, ok := NewestRelease([]Release{{Tag: ""}}); ok {
		t.Error("an untagged entry is not a release to move to")
	}
}

// An update never moves backwards. A person who names an older release means it, and the command does
// what it is told; the automatic pick refuses, naming both so it cannot read as a fetch failure.
func TestAnUpdateThatWouldGoBackwardsIsRefused(t *testing.T) {
	releases := []Release{{Tag: "v0.10.0-beta.14"}, {Tag: "v0.9.38"}}
	_, err := UpdateTarget("", releases, "v0.10.0-beta.15")
	if err == nil {
		t.Fatal("a downgrade nobody asked for must be refused")
	}
	for _, named := range []string{"v0.10.0-beta.14", "v0.10.0-beta.15"} {
		if !strings.Contains(err.Error(), named) {
			t.Errorf("the refusal should name %q: %v", named, err)
		}
	}
	// Forward is fine, and a machine with nothing it can name is not compared.
	if target, err := UpdateTarget("", releases, "v0.10.0-beta.13"); err != nil || target != "v0.10.0-beta.14" {
		t.Errorf("target = %q, %v", target, err)
	}
	if target, err := UpdateTarget("v0.10.0-beta.14", releases, "v0.10.0-beta.15"); err != nil || target != "v0.10.0-beta.14" {
		t.Errorf("a named release is the person's: %q, %v", target, err)
	}
	if _, err := UpdateTarget("", nil, "v0.10.0-beta.15"); err == nil {
		t.Error("an empty list is a sentence, not a silent no-op")
	}
}
