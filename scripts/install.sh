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
# The repository is public, so no token is needed. The release files are read from the browser URLs,
# not the API: the API has a 60-requests-an-hour quota per IP, and the browser URLs have none.
set -eu

VERSION=""
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

releases="https://github.com/marcelowa/acornfall/releases"

# available says whether a tag carries both files this install needs. A HEAD is enough: the
# release is public, and a draft's browser URLs answer 404 even with a token.
available() {
	for file in "$asset" sha256sums.txt; do
		code="$(curl -sSIL -o /dev/null -w '%{http_code}' "$releases/download/$1/$file" 2>/dev/null || true)"
		[ "$code" = "200" ] || return 1
	done
	return 0
}

# newest is the first tag in the public feed that can actually be installed. The feed lists every
# release, pre-releases included, newest first; a stable tag is preferred over a beta, which is what
# makes this keep working the day there is a 1.0. The feed is not the API: no token, no quota.
newest() {
	feed="$(curl -fsSL "$releases.atom" 2>/dev/null)" || return 1
	tags="$(printf '%s' "$feed" | sed -n 's|.*<id>tag:github.com,2008:Repository/[0-9]*/\(v[^<]*\)</id>.*|\1|p')"
	[ -n "$tags" ] || return 1
	for want in stable any; do
		for tag in $tags; do
			case "$tag" in
				*-*) [ "$want" = stable ] && continue ;;
			esac
			if available "$tag"; then
				echo "$tag"
				return 0
			fi
		done
	done
	return 1
}

if [ -z "$VERSION" ]; then
	VERSION="$(newest)" || {
		echo "install.sh: cannot find a release with $asset and sha256sums.txt"
		exit 2
	}
fi
if ! available "$VERSION"; then
	echo "install.sh: $VERSION does not carry $asset and sha256sums.txt (a draft or a release whose run did not finish)"
	exit 2
fi
echo "install.sh: release $VERSION, asset $asset"

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
get() {
	curl -fsSL "$releases/download/$VERSION/$1" -o "$2"
}
get "$asset" "$tmp/acornfall"
get sha256sums.txt "$tmp/sha256sums.txt"

want="$(grep " $asset\$" "$tmp/sha256sums.txt" | cut -d" " -f1)"
[ -n "$want" ] || { echo "install.sh: checksum file names no $asset"; exit 2; }
[ "$(sum "$tmp/acornfall")" = "$want" ] || { echo "install.sh: CHECKSUM MISMATCH, refusing"; exit 1; }
echo "install.sh: checksum OK"
chmod +x "$tmp/acornfall"

# shellcheck disable=SC2086
"$tmp/acornfall" machine install $PASS
