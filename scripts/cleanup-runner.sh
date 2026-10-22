#!/bin/sh
# Cleans the self-hosted runner's disk: the appliance cache, and the state an aborted run left.
#
# The runner is one long-lived container (ADR 0021), so nothing resets it between jobs. What
# grows there is what CI itself writes: about 155 MB per distinct appliance in ~/acornfall-ci
# (prove.yml:39, release.yml:300), a folder per tag in ~/acornfall-release (release.yml:310), and
# a machine's disk under /tmp/msb-prove when a run is cancelled.
#
#   scripts/cleanup-runner.sh            report only; deletes nothing
#   scripts/cleanup-runner.sh --apply    delete what the report names
#
# It touches the folders named below and nothing else. A cleanup that walks $HOME is one glob
# away from the mount, and the mount is the product's files (docs/engineering/the-appliance.md).
set -eu

APPLY=0
case "${1:-}" in
--apply) APPLY=1 ;;
"") ;;
*)
	printf 'usage: %s [--apply]\n' "$0" >&2
	exit 2
	;;
esac

# How many appliances stay. prove.yml asks for the hash a push just produced, with a warning when
# it is missing, so a pruned one costs the next tag one build and nothing else.
KEEP=${KEEP:-2}
# Days before a folder from a finished tag, or from a cancelled run, counts as left over. A day
# is longer than any job, so nothing a run is still writing is inside it.
STALE=${STALE:-7}
# Percent free under $HOME. The floor is the alert: a full disk fails every job at checkout, and
# the message it fails with is about the checkout.
FLOOR=${FLOOR:-10}

CI_DIR=${CI_DIR:-$HOME/acornfall-ci}
RELEASE_DIR=${RELEASE_DIR:-$HOME/acornfall-release}
TMP=${TMPDIR:-/tmp}

FREED=0

say() { printf '%s\n' "$*"; }

# Removes one path, or says what it would remove. The caller picks the path, and every caller
# below names a folder CI wrote: this function is never given a glob or a variable from a file.
remove() {
	size=$(du -sk "$1" 2>/dev/null | cut -f1)
	FREED=$((FREED + ${size:-0}))
	if [ "$APPLY" = 1 ]; then
		rm -rf -- "$1"
		say "removed $1"
	else
		say "would remove $1"
	fi
}

# True when the path's own mtime is older than STALE days. -maxdepth 0 so a folder's contents do
# not keep it alive: a cancelled run's machine disk is touched, its folder is not.
old() { [ -n "$(find "$1" -maxdepth 0 -mtime +"$STALE" 2>/dev/null)" ]; }

# The appliance cache. The names are build hashes, so no name holds a space and ls's order is
# safe to read; the newest KEEP stay.
if [ -d "$CI_DIR" ]; then
	kept=0
	for appliance in $(ls -1t "$CI_DIR"/*.tar.gz 2>/dev/null); do
		kept=$((kept + 1))
		if [ "$kept" -gt "$KEEP" ]; then
			remove "$appliance"
		fi
	done
	say "appliances: $kept on disk, keeping $KEEP"
fi

# The checksum lines a tag's publish assembles. A few bytes each, but a tag is forever, and
# nothing reads a tag's folder once its release is public.
if [ -d "$RELEASE_DIR" ]; then
	for tag in "$RELEASE_DIR"/*; do
		if [ -d "$tag" ] && old "$tag"; then
			remove "$tag"
		fi
	done
fi

# The engine's state, which prove.yml and the release's own proof both keep at /tmp/msb-prove.
# A cancelled run leaves a machine's disk there, and that disk is the biggest thing a run writes.
for path in "$TMP/msb-prove" "$TMP/clean"; do
	if [ -e "$path" ] && old "$path"; then
		remove "$path"
	fi
done

# The end-to-end suite's temp folders, which a killed run does not clean up (G16): a per-test
# tree, and a short root for sockets, which have a path length limit. The shared image cache is
# skipped by name, because deleting it makes the next suite meet the registry's anonymous rate
# limit (Makefile SANDBOX_STATE).
for path in "$TMP"/acornfall-* "$TMP"/af-*; do
	if [ ! -e "$path" ]; then
		continue
	fi
	if [ "$path" = "$TMP/acornfall-e2e-sandboxes" ]; then
		continue
	fi
	if old "$path"; then
		remove "$path"
	fi
done

# Processes are reported, not killed. A machine from a cancelled run holds memory, but a job that
# kills a process it cannot name is how a cleanup kills the next run's machine, so the names are
# printed for a person to act on.
running=$(ps -eo pid,etime,comm 2>/dev/null |
	awk '$3 ~ /^(cloud-hypervisor|firecracker|microsandbox)$/ {print "  " $0}')
if [ -n "$running" ]; then
	say "still running:"
	printf '%s\n' "$running"
fi
if command -v lxc >/dev/null 2>&1; then
	containers=$(lxc list -c ns --format csv 2>/dev/null | grep -E '^acornfall-' | cut -d, -f1 || true)
	if [ -n "$containers" ]; then
		say "containers:"
		printf '%s\n' "$containers" | sed 's/^/  /'
	fi
fi

free=$(df -Pk "$HOME" | awk 'NR==2 {printf "%d", ($4 * 100) / ($3 + $4)}')
say "reclaimed: $((FREED / 1024)) MiB; free under $HOME: ${free}% (floor ${FLOOR}%)"
if [ "$APPLY" != 1 ]; then
	say "report only: nothing was removed (--apply deletes)"
fi
if [ "$free" -lt "$FLOOR" ]; then
	say "the disk is under the floor: the next job fails at checkout, not where the space went"
	exit 1
fi
