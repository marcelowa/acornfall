#!/bin/sh
# The cleanup deletes files, so what it keeps is the part worth a test: the newest appliances
# stay, the older ones go, and nothing outside the named folders is ever touched — including the
# engine's shared image cache, which must survive every sweep.
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
work=$(mktemp -d)
trap 'rm -rf "$work"' EXIT

fail() {
	printf 'FAIL: %s\n' "$*" >&2
	exit 1
}

# Five appliances, each older than the next, so "newest" is a fact and not a hope.
appliances="$work/home/acornfall-ci"
mkdir -p "$appliances" "$work/home/acornfall-release/v0.1.0" "$work/tmp" "$work/home/acornfall"
i=1
while [ "$i" -le 5 ]; do
	printf 'appliance %s\n' "$i" >"$appliances/hash$i.tar.gz"
	touch -t "2026010${i}0000" "$appliances/hash$i.tar.gz"
	i=$((i + 1))
done

# What a killed run leaves, and the three things the sweep must not touch.
mkdir -p "$work/tmp/msb-prove" "$work/tmp/acornfall-e2e-1234" "$work/tmp/acornfall-e2e-sandboxes" \
	"$work/tmp/af-9999"
touch -t 202601010000 "$work/tmp/msb-prove" "$work/tmp/acornfall-e2e-1234"
touch -t 202601010000 "$work/tmp/acornfall-e2e-sandboxes" "$work/tmp/af-9999"
printf 'the product\n' >"$work/home/keep.txt"
printf 'mine\n' >"$work/home/acornfall/state.json"
touch -t 202601010000 "$work/home/keep.txt" "$work/home/acornfall/state.json"

run() {
	env HOME="$work/home" CI_DIR="$appliances" RELEASE_DIR="$work/home/acornfall-release" \
		TMPDIR="$work/tmp" FLOOR=0 KEEP=2 sh "$root/scripts/cleanup-runner.sh" "$@"
}

# The report is the default: it names the files and deletes none of them.
run >"$work/report.txt" || fail "the report run failed"
[ -f "$appliances/hash1.tar.gz" ] || fail "the report run deleted an appliance"
grep -q "would remove $appliances/hash1.tar.gz" "$work/report.txt" ||
	fail "the report did not name the appliance it would remove"

run --apply >/dev/null || fail "the apply run failed"

for gone in hash1 hash2 hash3; do
	[ ! -e "$appliances/$gone.tar.gz" ] ||
		fail "$gone.tar.gz should have gone: the newest two are what stays"
done
for kept in hash4 hash5; do
	[ -f "$appliances/$kept.tar.gz" ] || fail "$kept.tar.gz is one of the newest two and was removed"
done

[ ! -e "$work/tmp/msb-prove" ] || fail "a week-old /tmp/msb-prove should have been removed"
[ ! -e "$work/tmp/acornfall-e2e-1234" ] || fail "a week-old test folder should have been removed"
[ ! -e "$work/tmp/af-9999" ] || fail "a week-old socket root should have been removed"
[ -d "$work/tmp/acornfall-e2e-sandboxes" ] ||
	fail "the engine's image cache must survive: deleting it costs the next suite a rate limit"
[ -f "$work/home/keep.txt" ] || fail "a file outside the named folders was removed"
[ -f "$work/home/acornfall/state.json" ] || fail "~/.acornfall is not this script's to clean"

# A folder a run is writing is younger than the threshold, and stays.
mkdir -p "$work/tmp/acornfall-e2e-running"
run --apply >/dev/null || fail "the second apply run failed"
[ -d "$work/tmp/acornfall-e2e-running" ] || fail "a folder from a running job was removed"

# The floor is the alert, so it has to fail: a free disk above 100% is not a thing, and a floor
# of 101 is the one way to reach the branch without filling a real disk.
if env HOME="$work/home" CI_DIR="$appliances" RELEASE_DIR="$work/home/acornfall-release" \
	TMPDIR="$work/tmp" FLOOR=101 sh "$root/scripts/cleanup-runner.sh" >/dev/null 2>&1; then
	fail "a disk under the floor must exit non-zero, or the alert never fires"
fi

printf 'cleanup-runner: keeps the newest, removes the rest, touches nothing else\n'
