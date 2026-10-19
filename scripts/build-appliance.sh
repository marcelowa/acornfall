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
apt-get install -y -qq lxc skopeo umoci jq
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
# A mark a person, and doctor, can read: which appliance this is.
echo "acornfall appliance, debian stable, lxc $(lxc-start --version)" > /etc/acornfall-appliance
INNER
chroot "$ROOTFS" /bin/sh /tmp/appliance-setup.sh || die "arranging the appliance failed"
rm -f "$ROOTFS/tmp/appliance-setup.sh"

cleanup
trap - EXIT INT TERM

say "packing $OUT"
tar -czf "$OUT" -C "$ROOTFS" .
lxc-destroy -n "$NAME" >/dev/null 2>&1 || true
say "done: $OUT ($(du -h "$OUT" | cut -f1))"
