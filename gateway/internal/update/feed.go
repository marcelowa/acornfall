// The release feed: the source the console's check reads.
//
// `/releases/latest` is the wrong question for this project. It excludes pre-releases, and
// every release this project ships is a beta, so the check could only ever answer v0.9.38 —
// twenty-two betas behind the build it was running. The public releases feed lists every
// release, pre-releases included, and it has no anonymous quota: the API's 60 requests an
// hour per IP is the 403 a person saw when they pressed "check now".
package update

import (
	"context"
	"encoding/xml"
	"fmt"
	"html"
	"io"
	"net/http"
	"regexp"
	"sort"
	"strings"
	"time"
)

// FeedURL is GitHub's public releases feed: every release, pre-releases included, no token.
// It is the check's source. The API is still the source of asset ids and sizes; the feed is
// the source of "is there a newer release".
const FeedURL = "https://github.com/marcelowa/acornfall/releases.atom"

// LatestURL is the name older callers used. The feed is what it points at now: one constant
// for "where the newest release is", so a test or a mirror overrides one value.
const LatestURL = FeedURL

// atomFeed is the part of the feed this package reads. Namespaces are matched by local name,
// which is what encoding/xml does, so the three namespace declarations cost nothing here.
type atomFeed struct {
	Entries []atomEntry `xml:"entry"`
}

type atomEntry struct {
	ID      string `xml:"id"`
	Updated string `xml:"updated"`
	Link    struct {
		Href string `xml:"href,attr"`
	} `xml:"link"`
	Title   string `xml:"title"`
	Content string `xml:"content"`
}

// tagPattern is the one shape a release tag has here. The feed's title may carry a name after
// the tag ("v0.10.0-beta.32: One microVM per install"), so the tag is read from the entry id,
// which ends in it, and checked against this pattern rather than guessed from the title.
var tagPattern = regexp.MustCompile(`^v[0-9]+\.[0-9]+\.[0-9]+(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?$`)

// fetchFeed reads and parses the feed. A 403 or a timeout is returned as an error, which the
// caller turns into a soft state; a feed with no usable entry is an error too, because "no
// releases" is not an answer this project can give.
func (m *Manager) fetchFeed(ctx context.Context) ([]Release, error) {
	url := m.feedURL
	if url == "" {
		url = FeedURL
	}
	response, err := m.get(ctx, url)
	if err != nil {
		return nil, err
	}
	defer func() { _ = response.Body.Close() }()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("releases: github answered %s", response.Status)
	}
	feed, err := parseAtomFeed(response.Body)
	if err != nil {
		return nil, err
	}
	if len(feed) == 0 {
		return nil, fmt.Errorf("releases: the feed at %s listed no releases", url)
	}
	return feed, nil
}

// parseAtomFeed turns the feed's entries into the same Release the API path produced. A draft
// never appears in this feed, so there is no draft field to drop; an entry whose id is not a
// release tag is skipped, because one malformed row must not blank the check.
func parseAtomFeed(body io.Reader) ([]Release, error) {
	var feed atomFeed
	decoder := xml.NewDecoder(body)
	decoder.Strict = false
	if err := decoder.Decode(&feed); err != nil {
		return nil, fmt.Errorf("releases: cannot read the feed: %w", err)
	}
	releases := make([]Release, 0, len(feed.Entries))
	for _, entry := range feed.Entries {
		tag := tagFromEntryID(entry.ID)
		if tag == "" {
			continue
		}
		published := entry.Updated
		if parsed, err := time.Parse(time.RFC3339, published); err == nil {
			published = parsed.UTC().Format(time.RFC3339)
		}
		releases = append(releases, Release{
			Tag:         tag,
			Name:        releaseName(tag, entry.Title),
			Notes:       plainNotes(entry.Content),
			PublishedAt: published,
			Prerelease:  strings.Contains(tag, "-"),
		})
	}
	return releases, nil
}

// tagFromEntryID reads the tag from the feed's id, which has the shape
// "tag:github.com,2008:Repository/<id>/v0.10.0-beta.33". The title is not used: a release may
// name itself, and a parser that reads the first word gets "v0.10.0-beta.32:" on those.
func tagFromEntryID(id string) string {
	if slash := strings.LastIndex(id, "/"); slash >= 0 {
		id = id[slash+1:]
	}
	tag := strings.TrimSpace(id)
	if !tagPattern.MatchString(tag) {
		return ""
	}
	return tag
}

// releaseName is the title without the tag it repeats, so the picker can print "v0.10.0-beta.32"
// and the name beside it rather than the same tag twice.
func releaseName(tag, title string) string {
	name := strings.TrimSpace(title)
	name = strings.TrimPrefix(name, tag)
	name = strings.TrimPrefix(name, ":")
	return strings.TrimSpace(name)
}

// plainNotes turns the feed's HTML into the text the rest of the page already renders. It is
// deliberately small: the feed's content is release notes, not a document to parse, and a
// failed unescape is worse than a stray angle bracket.
var tagStripper = regexp.MustCompile(`<[^>]*>`)

func plainNotes(content string) string {
	text := html.UnescapeString(content)
	// Paragraph and line breaks are the notes' own structure. Replace them before dropping tags.
	text = strings.NewReplacer("</p>", "\n\n", "<br>", "\n", "<br/>", "\n", "<br />", "\n", "</li>", "\n").Replace(text)
	text = tagStripper.ReplaceAllString(text, "")
	// Collapse the runs of blank lines the replacements leave, without touching a single newline
	// between two paragraphs.
	lines := strings.Split(text, "\n")
	out := make([]string, 0, len(lines))
	blank := 0
	for _, line := range lines {
		line = strings.TrimRight(line, " \t\r")
		if line == "" {
			blank++
			if blank > 2 {
				continue
			}
		} else {
			blank = 0
		}
		out = append(out, line)
	}
	return strings.TrimSpace(strings.Join(out, "\n"))
}

// feedList is the picker's fallback: when the API cannot answer (a 403, a 429, or a network
// that is not there), the public feed still lists the releases and their notes. The feed has
// no asset sizes, which is why this path is a fallback and not the picker's first source: an
// install still reads the tag's files from the API, and says so if it cannot.
func (m *Manager) feedList(ctx context.Context, limit int, includePrerelease bool, cause error) ([]Release, error) {
	releases, err := m.fetchFeed(ctx)
	if err != nil {
		return nil, fmt.Errorf("%w (and the feed: %v)", cause, err)
	}
	visible := make([]Release, 0, len(releases))
	for _, release := range releases {
		if release.Prerelease && !includePrerelease {
			continue
		}
		visible = append(visible, release)
	}
	sort.SliceStable(visible, func(i, j int) bool { return compareTags(visible[i].Tag, visible[j].Tag) > 0 })
	if limit > 0 && len(visible) > limit {
		visible = visible[:limit]
	}
	return visible, nil
}

// feedRelease looks a tag up in the feed. It is the fallback for a page whose by-name read hit
// the API's quota: the notes and the date are there, the asset ids are not, and the page can
// still say what changed. An apply still needs the API, and says so when it cannot read it.
func (m *Manager) feedRelease(ctx context.Context, tag string) (Release, bool) {
	releases, err := m.fetchFeed(ctx)
	if err != nil {
		return Release{}, false
	}
	for _, release := range releases {
		if release.Tag == tag {
			return release, true
		}
	}
	return Release{}, false
}
