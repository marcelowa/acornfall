#!/bin/sh
# Builds the appliance image: the Debian-stable rootfs the machine runs, with the container
# layer's own tools in it. ADR 0022 ships this as a release asset — the install unpacks it and the
# engine boots the machine from the directory — so nothing here needs a registry account.
#
#   scripts/build-appliance.sh [output.tar.gz]
#
# Needs: lxc, skopeo, umoci, jq (the same tools docs/engineering/lxc-spike.md names), root, and a
# network for apt. It pulls a Debian rootfs, installs into it through a chroot — no container
# namespaces, so it works on a machine that cannot run one yet — and packs the result.
set -eu

OUT=${1:-appliance-debian-stable.tar.gz}
NAME=acornfall-appliance-build
DIR=/var/lib/lxc/$NAME
ROOTFS=$DIR/rootfs
BASE=${BASE:-debian:stable-slim}
# The release this image is, when the build knows it: a tag in CI, nothing for a hand build.
VERSION=${VERSION:-}
# The product itself: the binary the release ships, and the worker's sources. Both default to this
# repository's own build, so an appliance built here is the appliance this checkout is.
BINARY=${BINARY:-$(pwd)/bin/acornfall}
WORKER=${WORKER:-$(pwd)/worker}
BUN_VERSION=${BUN_VERSION:-1.4.3}

say() { printf '%s\n' "$*"; }
die() { printf '%s\n' "$*" >&2; exit 1; }

command -v lxc-create >/dev/null 2>&1 || die "lxc is not installed: apt-get install -y lxc skopeo umoci jq"
command -v skopeo >/dev/null 2>&1 || die "skopeo is not installed: apt-get install -y skopeo"
command -v umoci >/dev/null 2>&1 || die "umoci is not installed: apt-get install -y umoci"
command -v jq >/dev/null 2>&1 || die "jq is not installed: apt-get install -y jq"
[ "$(id -u)" = "0" ] || die "run as root: making a rootfs needs it"

cleanup() {
    umount "$ROOTFS/dev/pts" 2>/dev/null || true
    umount "$ROOTFS/dev" 2>/dev/null || true
    umount "$ROOTFS/proc" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

say "pulling $BASE into $ROOTFS"
lxc-destroy -n "$NAME" >/dev/null 2>&1 || true
lxc-create -n "$NAME" -t oci -- -u "docker://$BASE" >/dev/null || die "lxc-create failed"

# The install runs in a chroot rather than a container: apt needs the machine's network, a chroot
# has it, and nothing here needs namespaces — which is what made the container attempt fail on a
# machine that had never run one.
mkdir -p "$ROOTFS/proc" "$ROOTFS/dev/pts"
mount --bind /proc "$ROOTFS/proc" || die "mounting /proc failed"
mount --bind /dev "$ROOTFS/dev" || die "mounting /dev failed"
mount --bind /dev/pts "$ROOTFS/dev/pts" || die "mounting /dev/pts failed"
cp /etc/resolv.conf "$ROOTFS/etc/resolv.conf"

say "installing the container layer's tools"
# The steps run as scripts inside the rootfs: one quote too many is a build nobody can read.
cat >"$ROOTFS/tmp/appliance-install.sh" <<'INNER'
set -e
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get install -y -qq lxc skopeo umoci jq unzip curl iptables iproute2
apt-get clean
rm -rf /var/lib/apt/lists/*
INNER
chroot "$ROOTFS" /bin/sh /tmp/appliance-install.sh || die "installing the tools failed"
rm -f "$ROOTFS/tmp/appliance-install.sh"

say "arranging the appliance's own bits"
cat >"$ROOTFS/tmp/appliance-setup.sh" <<'INNER'
set -e
# The appliance's own folder inside the machine. The product's state is not here: it lives in the
# folder the machine mounts (ADR 0022), so this holds runtime files and logs only.
mkdir -p /var/lib/acornfall
# The id ranges an unprivileged container maps. The shim writes the per-owner entry at runtime;
# the shifted root range is the image's business, and having it here means a machine that can
# start a container the first time it is asked.
grep -q "^root:100000:" /etc/subuid || echo "root:100000:65536" >> /etc/subuid
grep -q "^root:100000:" /etc/subgid || echo "root:100000:65536" >> /etc/subgid
INNER
chroot "$ROOTFS" /bin/sh /tmp/appliance-setup.sh || die "arranging the appliance failed"
rm -f "$ROOTFS/tmp/appliance-setup.sh"

# The product: acornfall and the worker it runs. Both go in so the appliance starts with no
# network of its own and no first-boot download (ADR 0022: one image to update, not four things).
[ -x "$BINARY" ] || die "no acornfall binary at $BINARY: run make build, or pass BINARY=..."
[ -d "$WORKER/src" ] || die "no worker sources at $WORKER: pass WORKER=..."
say "putting acornfall and the worker into the image"
mkdir -p "$ROOTFS/usr/local/bin" "$ROOTFS/usr/local/lib/acornfall/worker"
cp "$BINARY" "$ROOTFS/usr/local/bin/acornfall"
chmod 755 "$ROOTFS/usr/local/bin/acornfall"
cp "$WORKER/package.json" "$WORKER/bun.lock" "$ROOTFS/usr/local/lib/acornfall/worker/"
cp -r "$WORKER/src" "$ROOTFS/usr/local/lib/acornfall/worker/src"

say "installing bun $BUN_VERSION and the worker's dependencies"
cat >"$ROOTFS/tmp/appliance-bun.sh" <<INNER
set -e
export DEBIAN_FRONTEND=noninteractive
export HOME=/root
case "\$(dpkg --print-architecture)" in
	amd64) BUN_ARCH=x64 ;;
	arm64) BUN_ARCH=aarch64 ;;
	*) echo "no bun for \$(dpkg --print-architecture)" >&2; exit 1 ;;
esac
curl -fsSL -o /tmp/bun.zip "https://github.com/oven-sh/bun/releases/download/bun-v$BUN_VERSION/bun-linux-\$BUN_ARCH.zip"
unzip -q -o /tmp/bun.zip -d /tmp/bun
find /tmp/bun -name bun -type f -exec install -m 755 {} /usr/local/bin/bun \;
rm -rf /tmp/bun /tmp/bun.zip
/usr/local/bin/bun --version
# Production only: the appliance runs the worker, it does not develop it, and the dev
# dependencies are three hundred megabytes of toolchain nothing there will ever call.
cd /usr/local/lib/acornfall/worker
/usr/local/bin/bun install --frozen-lockfile --production
# The appliance never runs the sandbox SDK: its engine is the machine's own lxc, and the SDK is
# only ever imported by the engine that needs a hypervisor. 103 MB of it would be disk spent on
# a dependency the machine cannot reach. Measured: the rootfs goes from 760M to 648M apparent.
rm -rf /usr/local/lib/acornfall/worker/node_modules/@superradcompany /usr/local/lib/acornfall/worker/node_modules/microsandbox
# bun's install cache is a build leftover: the worker runs from node_modules, which is right
# there. 179 MB, and the machine has no reason to keep a copy of what it already unpacked.
# The tools that only the build needed, and what a person never reads on a machine with no shell.
apt-get purge -y -qq curl unzip >/dev/null 2>&1 || true
apt-get autoremove -y -qq >/dev/null 2>&1 || true
rm -rf /usr/share/doc /usr/share/man /usr/share/locale /var/lib/apt/lists /var/cache/apt
rm -rf /root/.bun
INNER
chroot "$ROOTFS" /bin/sh /tmp/appliance-bun.sh || die "putting bun and the worker's dependencies in failed"
rm -f "$ROOTFS/tmp/appliance-bun.sh"

# A mark a person, and doctor, can read: which appliance this is.
# The mark names the appliance, and the release it is when the build was told which one. The
# launcher compares that release with its own: an image that does not say is one from before this
# mark carried a release, and it is replaced rather than booted under a newer launcher.
MARK="acornfall appliance${VERSION:+ $VERSION}"
chroot "$ROOTFS" /bin/sh -c "echo \"$MARK, debian stable, lxc \$(lxc-start --version)\" > /etc/acornfall-appliance" || die "naming the appliance failed"

cleanup
trap - EXIT INT TERM

say "packing $OUT"
tar -czf "$OUT" -C "$ROOTFS" .
# KEEP=1 leaves the rootfs where it is: the engine takes a rootfs directory, so a test — or a
# person — boots the machine straight from the build instead of unpacking the tarball again.
if [ "${KEEP:-0}" = "1" ]; then
	say "keeping the rootfs at $ROOTFS"
else
	lxc-destroy -n "$NAME" >/dev/null 2>&1 || true
fi
say "done: $OUT ($(du -h "$OUT" | cut -f1))"
