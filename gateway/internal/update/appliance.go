package update

import (
	"compress/gzip"
	"context"
	"fmt"
	"os"
	"path/filepath"
	"runtime"
	"time"
)

// The appliance is an artifact and a disk, and they are two different things (ADR 0026, amended).
// The artifact is the release's tarball, verified once and kept under the release's own name; the
// disk is what a machine boots, unpacked from it. They were one directory, `appliance/rootfs`,
// which means the tree a release shipped was also the tree a running machine wrote to: a container
// from a previous machine was in the next machine's image, and replacing the image replaced the
// disk of a machine that was using it.

// ApplianceTarball is where the release's verified appliance is kept: one file per tag, and the
// file's name is the release the bytes are. A machine's disk is unpacked from it, so the artifact
// outlives every disk made from it — `machine down` takes the disk and leaves this.
func ApplianceTarball(machinery, tag string) string {
	if tag == "" {
		return ""
	}
	return filepath.Join(machinery, "appliance", tag+".tar.gz")
}

// EnsureApplianceTarball makes the release's appliance exist at ApplianceTarball and returns that
// path. A tarball already there was verified against the release's own checksums when it was
// written, so this answers without the network — which is what lets an install make a machine
// offline, and what makes `machine down` followed by `machine up` a copy rather than a download.
// refresh fetches the release again, for a person who wants the bytes checked once more.
func (m *Manager) EnsureApplianceTarball(ctx context.Context, tag string, refresh bool) (string, error) {
	if tag == "" {
		return "", fmt.Errorf("update: no tag to fetch the appliance for")
	}
	path := ApplianceTarball(m.machinery, tag)
	if !refresh {
		if info, err := os.Stat(path); err == nil && !info.IsDir() && info.Size() > 0 {
			return path, nil
		}
	}
	release, err := m.releaseFor(ctx, tag)
	if err != nil {
		return "", err
	}
	// The asset's name says the architecture: an arm64 host that fetched an amd64 rootfs would
	// install a machine that cannot boot, and the failure would look like a broken image.
	name := applianceTarballName(runtime.GOARCH)
	asset := assetNamed(release, name)
	if asset.URL == "" {
		return "", fmt.Errorf("%w: release %s has no %s: this build is %s, and an appliance of another architecture cannot boot", ErrReleaseNotFound, release.Tag, name, runtime.GOARCH)
	}
	tarball, err := m.download(ctx, asset)
	if err != nil {
		return "", err
	}
	list, err := m.checksumList(ctx, release)
	if err != nil {
		return "", err
	}
	if err := verify(list, tarball, release.Tag); err != nil {
		return "", err
	}
	// Written beside it and moved into place, so a killed process leaves no artifact at all rather
	// than one that unpacks into half a machine. The artifact is what every disk is made from, so a
	// truncated one poisons every machine made afterwards, silently.
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return "", fmt.Errorf("update: cannot make room for the appliance in %s: %w", filepath.Dir(path), err)
	}
	if err := writeData(path, tarball); err != nil {
		return "", err
	}
	return path, nil
}

// UnpackApplianceFile makes dir the machine's disk from the tarball at path. It streams, so an
// appliance costs its unpacked size on disk and almost nothing in memory, and it unpacks beside
// the target and moves it into place: a tarball that fails half way leaves the disk that was
// there, not a machine with some of its files.
//
// dir is a disk this launcher made — `machines/<machine>/rootfs` — never the image directory of an
// install from before the layout, which is not ours to replace (ADR 0026, amended).
func UnpackApplianceFile(path, dir string) error {
	file, err := os.Open(path)
	if err != nil {
		return fmt.Errorf("update: no appliance tarball at %s: %w", path, err)
	}
	defer func() { _ = file.Close() }()
	compressed, err := gzip.NewReader(file)
	if err != nil {
		return fmt.Errorf("update: the appliance at %s is not a gzip stream: %w", path, err)
	}
	defer func() { _ = compressed.Close() }()
	// One staging directory per attempt, not one shared by every attempt: two processes that unpack the same
	// appliance — an install and the service, on a host where both are running — deleted each other's files and
	// failed with "unlinkat ...: directory not empty", which reads like a corrupt image and is a collision.
	staging := fmt.Sprintf("%s.partial.%d.%d", dir, os.Getpid(), time.Now().UnixNano())
	if err := os.MkdirAll(staging, 0o755); err != nil {
		return err
	}
	if err := UntarImage(compressed, staging); err != nil {
		// The half a disk is not a disk, and leaving it beside the target is a folder that grows
		// by one image per failed unpack.
		_ = os.RemoveAll(staging)
		return err
	}
	if err := os.RemoveAll(dir); err != nil {
		return err
	}
	return os.Rename(staging, dir)
}
