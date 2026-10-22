#!/bin/sh
# Install acornfall, or upgrade it: the release's binary is downloaded, verified, and handed to
# `machine install`, which writes the service's unit and starts it. Run it again to upgrade — install is
# idempotent and repairs what drifted.
#
#   sh install.sh [--remote|--local] [--version TAG]
#
# --remote publishes the console on 0.0.0.0, where it has no authentication; --local keeps it on
# 127.0.0.1. With neither, `machine install` asks, and a script with no terminal gets --remote. `--token`
# locks the console if you want that (`acornfall --token <secret>`, not this script).
#
# Needs curl and sha256sum (or shasum). The repository is public, so no GitHub token is needed;
# ACORNFALL_GITHUB_TOKEN is optional and lifts GitHub's anonymous rate limit.
set -eu

VERSION=""
TOKEN="${ACORNFALL_GITHUB_TOKEN:-}"
PASS=""

while [ $# -gt 0 ]; do
	case "$1" in
		--remote|--local) PASS="$PASS $1"; shift ;;
		--version) VERSION="$2"; shift 2 ;;
		-h|--help)
			echo "usage: install.sh [--remote|--local] [--version TAG]"
			echo "  --remote   publish the console on 0.0.0.0: the console has no authentication"
			echo "  --local    keep the console on 127.0.0.1"
			echo "  with neither, machine install asks (it needs a terminal to ask with)"
			exit 0
			;;
		*) echo "unknown flag $1"; exit 2 ;;
	esac
done

need() {
	command -v "$1" >/dev/null 2>&1 || { echo "install.sh: needs $1 on PATH"; exit 2; }
}
need curl
if command -v sha256sum >/dev/null 2>&1; then
	sum() { sha256sum "$1" | cut -d" " -f1; }
elif command -v shasum >/dev/null 2>&1; then
	sum() { shasum -a 256 "$1" | cut -d" " -f1; }
else
	echo "install.sh: needs sha256sum or shasum on PATH"
	exit 2
fi

os="$(uname -s | tr '[:upper:]' '[:lower:]')"
arch="$(uname -m)"
case "$os/$arch" in
	linux/x86_64) asset="acornfall-linux-amd64" ;;
	linux/aarch64|linux/arm64) asset="acornfall-linux-arm64" ;;
	darwin/x86_64) asset="acornfall-darwin-amd64" ;;
	darwin/aarch64|darwin/arm64) asset="acornfall-darwin-arm64" ;;
	*) echo "install.sh: no release for $os/$arch"; exit 2 ;;
esac

api() {
	curl -fsSL ${TOKEN:+-H "Authorization: Bearer $TOKEN"} -H "Accept: application/vnd.github+json" "$1"
}

# The tag: explicit, or the newest release. `/releases` rather than `/releases/latest`: latest excludes
# pre-releases, and this project ships nothing but betas.
if [ -z "$VERSION" ]; then
	VERSION="$(api 'https://api.github.com/repos/marcelowa/acornfall/releases?per_page=1' | tr -d '\n ' | grep -o '"tag_name":"[^"]*"' | head -n 1 | cut -d'"' -f4)"
	[ -n "$VERSION" ] || { echo "install.sh: no releases yet, or GitHub is rate-limiting this host (set ACORNFALL_GITHUB_TOKEN)"; exit 2; }
fi
echo "install.sh: release $VERSION, asset $asset"

release="$(api "https://api.github.com/repos/marcelowa/acornfall/releases/tags/$VERSION" | tr -d '\n ')" || {
	echo "install.sh: cannot read release $VERSION (a missing release is a 404; a 403 is GitHub's rate limit, lifted by ACORNFALL_GITHUB_TOKEN)"
	exit 2
}
asset_id() {
	printf '%s' "$release" | grep -o "\"id\":[0-9]*,\"node_id\":\"[A-Za-z0-9_=-]*\",\"name\":\"$1\"" | head -n 1 | cut -d: -f2 | cut -d, -f1
}
gateway_id="$(asset_id "$asset")"
sums_id="$(asset_id sha256sums.txt)"
[ -n "$gateway_id" ] && [ -n "$sums_id" ] || { echo "install.sh: $VERSION holds no $asset"; exit 2; }

# Its own folder, removed on the way out: the binary the installer copies from here is the only thing
# that has to survive the download.
tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
get() {
	curl -fsSL ${TOKEN:+-H "Authorization: Bearer $TOKEN"} -H "Accept: application/octet-stream" \
		"https://api.github.com/repos/marcelowa/acornfall/releases/assets/$1" -o "$2"
}
get "$gateway_id" "$tmp/acornfall"
get "$sums_id" "$tmp/sha256sums.txt"

want="$(grep " $asset\$" "$tmp/sha256sums.txt" | cut -d" " -f1)"
[ -n "$want" ] || { echo "install.sh: checksum file names no $asset"; exit 2; }
[ "$(sum "$tmp/acornfall")" = "$want" ] || { echo "install.sh: CHECKSUM MISMATCH, refusing"; exit 1; }
echo "install.sh: checksum OK"
chmod +x "$tmp/acornfall"

# shellcheck disable=SC2086
"$tmp/acornfall" machine install $PASS
