package update

import (
	"archive/tar"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// applianceFixture is a rootfs tarball with the three entry kinds that matter: a file, a directory
// and a symlink. The symlink is not decoration — an unpacker that drops one ships a machine with no
// /bin/sh (ADR 0026's context), and it is the entry a naive test never writes.
func applianceFixture(t *testing.T) []byte {
	t.Helper()
	var buffer bytes.Buffer
	compressed := gzip.NewWriter(&buffer)
	tarball := tar.NewWriter(compressed)
	body := []byte("#!/bin/sh\n")
	for _, entry := range []struct {
		header tar.Header
		body   []byte
	}{
		{header: tar.Header{Name: "usr/local/bin/acornfall", Typeflag: tar.TypeReg, Mode: 0o755, Size: int64(len(body))}, body: body},
		{header: tar.Header{Name: "bin", Typeflag: tar.TypeDir, Mode: 0o755}},
		{header: tar.Header{Name: "bin/sh", Typeflag: tar.TypeSymlink, Linkname: "/bin/dash", Mode: 0o777}},
	} {
		header := entry.header
		if err := tarball.WriteHeader(&header); err != nil {
			t.Fatal(err)
		}
		if len(entry.body) > 0 {
			if _, err := tarball.Write(entry.body); err != nil {
				t.Fatal(err)
			}
		}
	}
	if err := tarball.Close(); err != nil {
		t.Fatal(err)
	}
	if err := compressed.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}

// applianceReleaseServer answers one release by tag whose appliance is tarball, with a checksum
// file over sumOf. A good release passes the tarball twice; the test that asks what a checksum
// which does not match its artifact does passes something else.
func applianceReleaseServer(t *testing.T, tag string, tarball, sumOf []byte) *httptest.Server {
	t.Helper()
	name := applianceTarballName(runtime.GOARCH)
	sum := sha256.Sum256(sumOf)
	sums := fmt.Sprintf("%s  %s\n", hex.EncodeToString(sum[:]), name)
	mux := http.NewServeMux()
	mux.HandleFunc("/releases/tags/"+tag, func(w http.ResponseWriter, r *http.Request) {
		base := "http://" + r.Host
		assets := fmt.Sprintf(`{"name":%q,"browser_download_url":%q,"size":%d},{"name":"sha256sums.txt","browser_download_url":%q,"size":%d}`,
			name, base+"/appliance.tar.gz", len(tarball), base+"/sums.txt", len(sums))
		_, _ = w.Write([]byte(releaseJSON(tag, assets)))
	})
	mux.HandleFunc("/appliance.tar.gz", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write(tarball)
	})
	mux.HandleFunc("/sums.txt", func(w http.ResponseWriter, _ *http.Request) {
		_, _ = w.Write([]byte(sums))
	})
	return httptest.NewServer(mux)
}

// applianceManager is a manager whose release source is server, with both of its clients pointed at
// it: the metadata one for the release and the checksums, the large one for the artifact.
func applianceManager(t *testing.T, server *httptest.Server) (*Manager, string) {
	t.Helper()
	home := t.TempDir()
	manager := New(home, t.TempDir(), "", "")
	manager.latestURL = server.URL + "/releases/latest"
	manager.client = server.Client()
	manager.largeClient = server.Client()
	return manager, home
}

// The artifact is the release's tarball, kept under the release's own name, so a machine can be
// made from it later without asking GitHub again: `machine down` then `machine up` on an install
// with no network still boots.
func TestTheApplianceIsKeptAsTheTarball(t *testing.T) {
	tarball := applianceFixture(t)
	server := applianceReleaseServer(t, "v9.9.9", tarball, tarball)
	manager, home := applianceManager(t, server)

	path, err := manager.EnsureApplianceTarball(context.Background(), "v9.9.9", false)
	if err != nil {
		t.Fatal(err)
	}
	if want := filepath.Join(home, "appliance", "v9.9.9.tar.gz"); path != want {
		t.Errorf("the artifact is at %q, want %q", path, want)
	}
	if got, err := os.ReadFile(path); err != nil {
		t.Fatal(err)
	} else if !bytes.Equal(got, tarball) {
		t.Errorf("the artifact is not the bytes the release published: %d of %d", len(got), len(tarball))
	}

	// The release source goes away: a tarball that is here was verified when it was written, so a
	// second call is the file, not the network.
	server.Close()
	if again, err := manager.EnsureApplianceTarball(context.Background(), "v9.9.9", false); err != nil || again != path {
		t.Fatalf("an artifact that is already here needs no network: %q, %v", again, err)
	}
}

// A tag names the file, and no tag names nothing: a path built from "" is a file called ".tar.gz"
// that would be the artifact for every source build at once.
func TestTheApplianceTarballIsNamedForItsRelease(t *testing.T) {
	if got, want := ApplianceTarball("/home/me/.acornfall", "v0.10.0-beta.14"), "/home/me/.acornfall/appliance/v0.10.0-beta.14.tar.gz"; got != want {
		t.Errorf("ApplianceTarball = %q, want %q", got, want)
	}
	if got := ApplianceTarball("/home/me/.acornfall", ""); got != "" {
		t.Errorf("no tag is no artifact, got %q", got)
	}
}

// An artifact whose checksum does not match is not kept: the tarball is what every disk is made
// from, so a bad one poisons every machine made afterwards, silently.
func TestAnApplianceThatDoesNotVerifyIsNotKept(t *testing.T) {
	tarball := applianceFixture(t)
	// The release's own checksum file describes other bytes than the artifact it publishes.
	server := applianceReleaseServer(t, "v9.9.9", tarball, []byte("some other image"))
	manager, home := applianceManager(t, server)

	if _, err := manager.EnsureApplianceTarball(context.Background(), "v9.9.9", false); err == nil {
		t.Fatal("a checksum that does not match must stop the appliance")
	} else if !strings.Contains(err.Error(), "checksum mismatch") {
		t.Fatalf("want a checksum mismatch, got %v", err)
	}
	if _, err := os.Stat(filepath.Join(home, "appliance", "v9.9.9.tar.gz")); !os.IsNotExist(err) {
		t.Errorf("a refused artifact must not be left where the next disk would be made from it: %v", err)
	}
}

// The disk is made from the artifact, entry for entry: a file, a directory and a symlink. A disk
// that loses the symlink is a machine whose init cannot start.
func TestTheDiskIsUnpackedFromTheTarball(t *testing.T) {
	tarball := applianceFixture(t)
	path := filepath.Join(t.TempDir(), "v9.9.9.tar.gz")
	if err := os.WriteFile(path, tarball, 0o644); err != nil {
		t.Fatal(err)
	}
	disk := filepath.Join(t.TempDir(), "machines", "m", "rootfs")
	if err := UnpackApplianceFile(path, disk); err != nil {
		t.Fatal(err)
	}
	if body, err := os.ReadFile(filepath.Join(disk, "usr", "local", "bin", "acornfall")); err != nil {
		t.Fatal(err)
	} else if string(body) != "#!/bin/sh\n" {
		t.Errorf("the disk holds %q", body)
	}
	if link, err := os.Readlink(filepath.Join(disk, "bin", "sh")); err != nil {
		t.Fatal(err)
	} else if link != "/bin/dash" {
		t.Errorf("the symlink points at %q", link)
	}
}

// A tarball that fails half way leaves the disk that was there: an install that cannot make a new
// machine still has the one it had. Unpacking in place would be a machine with some of its files.
func TestAFailedUnpackLeavesTheDiskThatWasThere(t *testing.T) {
	disk := filepath.Join(t.TempDir(), "machines", "m", "rootfs")
	if err := os.MkdirAll(disk, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(disk, "keep"), []byte("the machine that is there"), 0o644); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "broken.tar.gz")
	if err := os.WriteFile(path, []byte("not a tarball at all"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := UnpackApplianceFile(path, disk); err == nil {
		t.Fatal("a broken artifact must not be reported as a machine")
	}
	if body, err := os.ReadFile(filepath.Join(disk, "keep")); err != nil {
		t.Fatalf("the disk that was there is gone: %v", err)
	} else if string(body) != "the machine that is there" {
		t.Errorf("the disk holds %q", body)
	}
	if _, err := os.Stat(disk + ".partial"); !os.IsNotExist(err) {
		t.Errorf("a failed unpack leaves a half disk behind: %v", err)
	}
}
