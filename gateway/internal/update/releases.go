package update

import "fmt"

// Picking the release an update moves to. The console's badge reads `/releases/latest`, which is the
// channel's own answer and excludes pre-releases — correct for a badge that means "the newest
// production release". A command whose whole job is "update me" cannot use it: this project ships
// nothing but betas, so "production only" is a command that never updates. The list endpoint carries
// every release including the pre-releases, drafts are already dropped by List, and the order is by
// version (compareTags), not by text.

// NewestRelease is the newest release in the list by version. v0.10.0-beta.15 is newer than v0.9.38
// and v0.9.10 is newer than v0.9.9 — the two comparisons a string would get wrong.
func NewestRelease(releases []Release) (Release, bool) {
	var newest Release
	for _, release := range releases {
		if release.Tag == "" {
			continue
		}
		if newest.Tag == "" || compareTags(release.Tag, newest.Tag) > 0 {
			newest = release
		}
	}
	return newest, newest.Tag != ""
}

// UpdateTarget is the release an update moves to: the tag a person named, or the newest in the list.
// A named tag is returned as it is — a person who names an older release means it. Without one, an
// update never goes backwards: the newest release being older than what the machine runs is a
// downgrade nobody asked for, and the sentence names both so it cannot be mistaken for a fetch
// failure.
func UpdateTarget(named string, releases []Release, running string) (string, error) {
	if named != "" {
		return named, nil
	}
	newest, ok := NewestRelease(releases)
	if !ok {
		return "", fmt.Errorf("no release to update to: the release list came back empty")
	}
	if running != "" && newerThan(running, newest.Tag) {
		return "", fmt.Errorf("the newest release is %s and this machine runs %s, so updating would go backwards: name a release with --tag if that is what you mean", newest.Tag, running)
	}
	return newest.Tag, nil
}
