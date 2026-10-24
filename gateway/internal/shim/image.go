package shim

import (
	"bytes"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// What a workspace image does not have, because a container is not the machine it runs on.
//
// The image is the project's environment (ADR 0021): anything from `debian:stable-slim` to a
// `golang:` or a devcontainer-style one. Two things are missing from all of them anyway:
//
//   - **the machine's certificate authorities.** A slim image ships no `/etc/ssl`, so the first
//     `curl https://…` fails with "Problem with the SSL CA cert (path? access rights?)", which
//     reads as a network fault and sends the reader looking at the wrong layer.
//   - **a passwd entry for the uid the tools run as.** That uid is the share's owner, which no
//     image has ever heard of, and a program that resolves its own uid refuses to start: ssh(1)
//     prints "No user exists for uid 999" before it touches the network.
//
// Both are written into the rootfs at create time, before the rootfs is handed to the container's
// own root, so the files are owned like everything else in it. acornfall#98.
const (
	// caBundleInContainer is where every Debian-derived tool looks first.
	caBundleInContainer = "etc/ssl/certs/ca-certificates.crt"
	// workspaceUser is the name the container gives the share's owner.
	workspaceUser = "acornfall"
)

// caBundleInMachine is where the appliance keeps the roots it inherits. A variable, not a
// constant, so a test can name a file it owns: the path is the machine's, and a test that read
// the real one would be asserting something about the machine it happens to run on.
var caBundleInMachine = "/etc/ssl/certs/ca-certificates.crt"

// certsFor copies the machine's trust store into the container, so a workspace trusts what the
// machine trusts instead of shipping its own idea of it.
//
// A machine without a bundle writes nothing and says nothing: the appliance's own build installs
// ca-certificates for skopeo and curl, so an absent one means the image was made by hand — and
// failing a create over it would take a workspace down to fix a certificate it may never need.
// The container behaves exactly as it did before this existed.
func certsFor(rootfs string) error {
	bundle, err := os.ReadFile(caBundleInMachine)
	if err != nil {
		return nil
	}
	target := filepath.Join(rootfs, caBundleInContainer)
	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		return err
	}
	return os.WriteFile(target, bundle, 0o644)
}

// passwdFor gives the container a name for the uid its tools run as, and a group for it beside.
//
// The image's own entries are kept: this adds one line each, and only when the id is not already
// named. An image that happens to have the same uid (a `node:` user at 1000, say) keeps its own
// name — the container needs *an* answer for the uid, not this particular one.
func passwdFor(rootfs, home string, owner, group int) error {
	if owner <= 0 {
		return nil // root: no image has ever lacked that entry
	}
	if strings.TrimSpace(home) == "" {
		home = "/"
	}
	entry := fmt.Sprintf("%s:x:%d:%d:%s:%s:/bin/sh\n", workspaceUser, owner, group, workspaceUser, home)
	if err := appendIfMissing(filepath.Join(rootfs, "etc", "passwd"), 2, owner, entry); err != nil {
		return err
	}
	// A passwd line whose group is not in /etc/group is a half-answer: `id` prints the number and
	// `getent group` finds nothing.
	groupEntry := fmt.Sprintf("%s:x:%d:\n", workspaceUser, group)
	return appendIfMissing(filepath.Join(rootfs, "etc", "group"), 2, group, groupEntry)
}

// appendIfMissing adds line to the file unless the field at index already holds id. It is a
// colon-separated file, which is what both of these are, and it keeps the file readable and owned
// exactly as the image made it.
func appendIfMissing(path string, field, id int, line string) error {
	contents, err := os.ReadFile(path)
	if err != nil && !os.IsNotExist(err) {
		return err
	}
	for entry := range strings.SplitSeq(string(contents), "\n") {
		fields := strings.Split(entry, ":")
		if len(fields) <= field {
			continue
		}
		if value, convErr := strconv.Atoi(fields[field]); convErr == nil && value == id {
			return nil
		}
	}
	// A file with no final newline would otherwise join its last line to the new one, and the
	// entry we meant to add would be nobody's.
	if len(contents) > 0 && !bytes.HasSuffix(contents, []byte("\n")) {
		contents = append(contents, '\n')
	}
	contents = append(contents, line...)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		return err
	}
	return os.WriteFile(path, contents, 0o644)
}
