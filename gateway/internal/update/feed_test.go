package update

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// The feed is the check's source: /releases/latest excludes pre-releases, and every release
// this project ships is a beta. The fixture is the real answer's shape: the tag is in the
// entry id, the title may carry a name after the tag, and the notes are HTML.
const feedFixture = `<?xml version="1.0" encoding="UTF-8"?>
<feed xmlns="http://www.w3.org/2005/Atom" xml:lang="en-US">
  <title>Release notes from acornfall</title>
  <entry>
    <id>tag:github.com,2008:Repository/1/v0.9.38</id>
    <updated>2026-10-12T00:00:00Z</updated>
    <title>v0.9.38</title>
    <content type="html">&lt;p&gt;the last stable&lt;/p&gt;</content>
  </entry>
  <entry>
    <id>tag:github.com,2008:Repository/1/v0.10.0-beta.33</id>
    <updated>2026-10-23T06:09:03Z</updated>
    <title>v0.10.0-beta.33</title>
    <content type="html">&lt;p&gt;A workspace says when it can be used.&lt;/p&gt;
&lt;p&gt;The console reads one phase.&lt;/p&gt;</content>
  </entry>
  <entry>
    <id>tag:github.com,2008:Repository/1/v0.10.0-beta.32</id>
    <updated>2026-10-23T05:18:07Z</updated>
    <title>v0.10.0-beta.32: One microVM per install</title>
    <content type="html">&lt;p&gt;A container that was cut short is remade.&lt;/p&gt;</content>
  </entry>
</feed>`

func feedServer(t *testing.T) *httptest.Server {
	t.Helper()
	return httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !strings.HasSuffix(r.URL.Path, ".atom") {
			// The API is the other source; this server only answers the feed. A test that asks
			// for the API by mistake gets a refusal rather than the public internet.
			http.Error(w, "no api here", http.StatusForbidden)
			return
		}
		w.Header().Set("Content-Type", "application/atom+xml")
		_, _ = w.Write([]byte(feedFixture))
	}))
}

// The check finds the newest beta, and the status says it is available over the running build.
// The API's /releases/latest answers v0.9.38 while beta.33 exists; the feed answers beta.33.
func TestTheCheckReadsTheFeedAndSeesPreReleases(t *testing.T) {
	manager, _ := testManager(t)
	server := feedServer(t)
	defer server.Close()
	manager.latestURL = server.URL + "/releases.atom"
	manager.feedURL = manager.latestURL
	manager.client = server.Client()
	manager.current = "v0.10.0-beta.32"

	release, err := manager.Check(context.Background())
	if err != nil {
		t.Fatal(err)
	}
	if release.Tag != "v0.10.0-beta.33" {
		t.Fatalf("the newest beta is beta.33, got %q", release.Tag)
	}
	status := manager.Status()
	if status.Latest != "v0.10.0-beta.33" || !status.Available {
		t.Fatalf("the check should offer beta.33 over beta.32, got %+v", status)
	}
	if !strings.Contains(status.Notes, "one phase") {
		t.Errorf("the feed's notes should reach the status, got %q", status.Notes)
	}
	if status.CheckError != "" {
		t.Errorf("a successful check should have no error, got %q", status.CheckError)
	}
}

// A failed check is a soft state, not a lost release: the last good answer stays, and the
// sentence is on the status for the page to print. The handler no longer turns this into 502.
func TestAFailedCheckKeepsTheLastGoodReleaseAndSaysWhy(t *testing.T) {
	manager, _ := testManager(t)
	good := feedServer(t)
	defer good.Close()
	manager.latestURL = good.URL + "/releases.atom"
	manager.feedURL = manager.latestURL
	manager.client = good.Client()
	manager.current = "v0.10.0-beta.32"
	if _, err := manager.Check(context.Background()); err != nil {
		t.Fatal(err)
	}

	bad := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		http.Error(w, "rate limited", http.StatusForbidden)
	}))
	defer bad.Close()
	manager.latestURL = bad.URL + "/releases.atom"
	manager.feedURL = manager.latestURL
	manager.client = bad.Client()
	if _, err := manager.Check(context.Background()); err == nil {
		t.Fatal("a 403 must be reported to the caller")
	}
	status := manager.Status()
	if status.Latest != "v0.10.0-beta.33" {
		t.Errorf("the last good release should stay, got %q", status.Latest)
	}
	if !strings.Contains(status.CheckError, "403") {
		t.Errorf("the failure should carry the answer, got %q", status.CheckError)
	}
}

// The tag is read from the entry id, never from the title: a release that names itself would
// otherwise become "v0.10.0-beta.32:" and stop comparing as a version.
func TestTheFeedReadsTheTagFromTheEntryID(t *testing.T) {
	releases, err := parseAtomFeed(strings.NewReader(feedFixture))
	if err != nil {
		t.Fatal(err)
	}
	if len(releases) != 3 {
		t.Fatalf("got %d releases, want 3", len(releases))
	}
	if releases[2].Tag != "v0.10.0-beta.32" {
		t.Errorf("the named release's tag = %q, want v0.10.0-beta.32", releases[2].Tag)
	}
	if releases[2].Name != "One microVM per install" {
		t.Errorf("the name after the tag = %q", releases[2].Name)
	}
	if releases[1].Prerelease != true || releases[0].Prerelease != false {
		t.Errorf("prerelease flags follow the tag: %+v", releases)
	}
}

// The page's by-name read falls back to the feed when the API's quota is gone: the notes and
// the date are enough to say what changed, even though the files need the API.
func TestAReleaseFallsBackToTheFeedWhenTheAPIAnswers403(t *testing.T) {
	manager, _ := testManager(t)
	api := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.HasSuffix(r.URL.Path, ".atom") {
			_, _ = w.Write([]byte(feedFixture))
			return
		}
		http.Error(w, "rate limited", http.StatusForbidden)
	}))
	defer api.Close()
	manager.client = api.Client()
	manager.latestURL = api.URL + "/releases.atom"
	manager.feedURL = manager.latestURL
	manager.apiBaseURL = api.URL

	release, err := manager.Release(context.Background(), "v0.10.0-beta.33")
	if err != nil {
		t.Fatal(err)
	}
	if release.Tag != "v0.10.0-beta.33" || !strings.Contains(release.Notes, "one phase") {
		t.Fatalf("the feed's release should carry its notes, got %+v", release)
	}
}

func TestTheFeedListHidesPrereleasesUnlessAsked(t *testing.T) {
	manager, _ := testManager(t)
	server := feedServer(t)
	defer server.Close()
	manager.latestURL = server.URL + "/releases.atom"
	manager.feedURL = manager.latestURL
	manager.apiBaseURL = server.URL
	manager.client = server.Client()

	stable, err := manager.List(context.Background(), 20, false)
	if err != nil {
		t.Fatal(err)
	}
	if got := testTags(stable); got != "v0.9.38" {
		t.Errorf("stable list = %s, want v0.9.38", got)
	}
	all, err := manager.List(context.Background(), 20, true)
	if err != nil {
		t.Fatal(err)
	}
	if got := testTags(all); got != "v0.10.0-beta.33,v0.10.0-beta.32,v0.9.38" {
		t.Errorf("all list = %s", got)
	}
}

// A tag that is not a release tag is skipped, not allowed to become a Release with a name that
// sorts somewhere unpredictable.
func TestAnEntryWithNoReleaseTagIsSkipped(t *testing.T) {
	releases, err := parseAtomFeed(strings.NewReader(`<feed><entry><id>tag:github.com,2008:Repository/1/not-a-tag</id><title>not a tag</title></entry></feed>`))
	if err != nil {
		t.Fatal(err)
	}
	if len(releases) != 0 {
		t.Errorf("a non-tag entry should be skipped, got %+v", releases)
	}
}

// The parser must not need the namespace declarations to be understood: encoding/xml matches
// the local name, and a feed with no xmlns is the same document to this reader.
func TestTheFeedParsesWithoutNamespaces(t *testing.T) {
	body := fmt.Sprintf(`<feed>%s</feed>`, `<entry><id>tag:github.com,2008:Repository/1/v0.10.0-beta.33</id><title>v0.10.0-beta.33</title><content>notes</content></entry>`)
	releases, err := parseAtomFeed(strings.NewReader(body))
	if err != nil {
		t.Fatal(err)
	}
	if len(releases) != 1 || releases[0].Tag != "v0.10.0-beta.33" {
		t.Fatalf("got %+v", releases)
	}
}
