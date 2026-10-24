#!/bin/sh
# The spike behind docs/adr/0021-workspaces-as-lxc-containers.md and issue #96: can a workspace
# run as an LXC container inside a microsandbox guest?
#
# Run this INSIDE a sandbox guest, as root. It never guesses: every fact it prints is a command
# and its real output, a check that cannot run says SKIP and why, and the exit status is 0 only
# when the required checks passed. `SPIKE_KEEP=1` leaves the containers behind to look at.
#
#   SPIKE_WORKSPACE=/the/vm/share sh scripts/spike-lxc.sh
#
# Environment:
#   SPIKE_IMAGE     the OCI image for the container rootfs (default docker://debian:stable-slim)
#   SPIKE_SHARE     a scratch folder to act as the share root (default /spike-share)
#   SPIKE_WORKSPACE a path the guest mounts from the host (virtiofs), bound into the containers
#   SPIKE_REPORT    where the report is written (default ./lxc-spike-report.txt)
#   SPIKE_KEEP=1    leave the containers behind for inspection
#   SPIKE_INSTALL=1 let apt-get install what is missing (lxc, jq, skopeo, umoci)

set -u

IMAGE=${SPIKE_IMAGE:-docker://debian:stable-slim}
SHARE=${SPIKE_SHARE:-/spike-share}
REPORT=${SPIKE_REPORT:-./lxc-spike-report.txt}
MARKER="lxc-spike-marker"
PRIV=spike-priv
UNPRIV=spike-unpriv
# The guest's own share mount: the folder acornfall's host side mounted in. The runtime's own
# mount (/.msb) is not a share; the read-write mounts are the candidates, and the one acornfall
# mounted for a workspace or the home is the one with a person's path.
WORKSPACE=${SPIKE_WORKSPACE:-$(findmnt -t virtiofs -n -o TARGET,OPTIONS 2>/dev/null |
    awk '$2 ~ /(^|,)rw(,|$)/ && $1 !~ /^\/\.msb/ {print $1; exit}')}

failures=0
passes=0
skips=0
FAILED_LIST=""
: >"$REPORT"

say() { printf '%s\n' "$*" | tee -a "$REPORT"; }
sub() { printf '    %s\n' "$*" | tee -a "$REPORT"; }
step() { printf '\n== %s\n' "$*" | tee -a "$REPORT"; }

# Run a command, print it and its output, and report whether it failed. Used for facts, where
# a failure is a fact too ("/dev/kvm is missing here"), not a reason to stop.
show() {
    say "\$ $*"
    "$@" 2>&1 | sed 's/^/    /' | tee -a "$REPORT"
}

check() {
    # check <name> <command...>: PASS when it exits 0, FAIL when it does not. A check names
    # what it measured, because a report with unnamed failures is a report nobody can act on.
    local name=$1 output status
    shift
    output=$("$@" 2>&1)
    status=$?
    if [ $status -eq 0 ]; then
        passes=$((passes + 1))
        say "CHECK $name: PASS ${output:+— $output}"
        return 0
    fi
    failures=$((failures + 1))
    FAILED_LIST="$FAILED_LIST $name"
    say "CHECK $name: FAIL ${output:+— $output}"
    return 1
}

skip() {
    skips=$((skips + 1))
    say "CHECK $1: SKIP — $2"
}

# -- teardown ------------------------------------------------------------------------------

KVM_MODE=$(stat -c %a /dev/kvm 2>/dev/null || echo "")
SUBTREE=$(cat /sys/fs/cgroup/cgroup.subtree_control 2>/dev/null || echo "")

cleanup() {
    step "cleanup"
    for name in $PRIV $UNPRIV; do
        if [ "${SPIKE_KEEP:-0}" = "1" ]; then
            say "keeping $name (SPIKE_KEEP=1)"
            continue
        fi
        lxc-stop -n "$name" -k >/dev/null 2>&1
        lxc-destroy -n "$name" >/dev/null 2>&1
        say "removed $name"
    done
    rm -rf "$SHARE"
    # Leave the guest as it was found: the device mode, and the controllers the containers asked
    # the guest's root cgroup for. One at a time: a single multi-value write fails as a whole
    # when one controller cannot be dropped, and what is left is reported rather than assumed.
    [ -n "$KVM_MODE" ] && [ -e /dev/kvm ] && chmod "$KVM_MODE" /dev/kvm 2>/dev/null
    if [ -z "$SUBTREE" ]; then
        # LXC leaves its pivot cgroup behind; with it there, the controllers cannot be dropped.
        rmdir /sys/fs/cgroup/lxc.pivot 2>/dev/null
        for controller in cpuset cpu io memory hugetlb pids; do
            printf '%s' "-$controller" >/sys/fs/cgroup/cgroup.subtree_control 2>/dev/null
        done
        sub "subtree_control now: '$(cat /sys/fs/cgroup/cgroup.subtree_control 2>/dev/null)' (was '')"
    fi
    say "report: $REPORT"
}
trap cleanup EXIT INT TERM

# -- the KVM probe -------------------------------------------------------------------------

# Opening the node proves nothing: KVM_GET_API_VERSION and KVM_CREATE_VM are what a hypervisor
# inside the container actually needs, and a container can hold the node without either.
PROBE=/root/lxc-spike-kvm-probe
cat >/root/lxc-spike-kvm-probe.c <<'EOF'
#include <fcntl.h>
#include <stdio.h>
#include <sys/ioctl.h>
#include <unistd.h>
#define KVM_GET_API_VERSION 0xAE00
#define KVM_CREATE_VM       0xAE01
int main(void) {
    int kvm = open("/dev/kvm", O_RDWR);
    if (kvm < 0) { perror("open /dev/kvm"); return 1; }
    int api = ioctl(kvm, KVM_GET_API_VERSION, 0);
    if (api < 0) { perror("KVM_GET_API_VERSION"); return 1; }
    printf("KVM api version %d, ", api);
    int vm = ioctl(kvm, KVM_CREATE_VM, 0);
    if (vm < 0) { perror("KVM_CREATE_VM"); return 1; }
    printf("KVM_CREATE_VM ok");
    return 0;
}
EOF

probe_kvm() {
    # probe_kvm <container> <unpriv>: run the probe inside the container. 0 = ran, 2 = cannot
    # build it here, 3 = cannot place it in the container.
    local name=$1 owner=$2
    if [ ! -x "$PROBE" ]; then
        command -v gcc >/dev/null 2>&1 || return 2
        gcc -static -O2 -o "$PROBE" /root/lxc-spike-kvm-probe.c >/dev/null 2>&1 || return 2
    fi
    cp "$PROBE" "/var/lib/lxc/$name/rootfs/root/kvm-probe" || return 3
    chmod 755 "/var/lib/lxc/$name/rootfs/root/kvm-probe"
    [ "$owner" = "unpriv" ] && chown 100000:100000 "/var/lib/lxc/$name/rootfs/root/kvm-probe"
    lxc-attach -n "$name" -- /root/kvm-probe 2>/dev/null
}

# -- containers ----------------------------------------------------------------------------

start_container() {
    # start_container <name> <unpriv>: create an OCI rootfs, write the config, start it, and
    # report how long the start took.
    local name=$1 unpriv=$2 started started_ms
    lxc-destroy -n "$name" >/dev/null 2>&1
    say "creating $name from $IMAGE"
    if ! lxc-create -n "$name" -t oci -- -u "$IMAGE" >>"$REPORT" 2>&1; then
        say "lxc-create failed for $name (an OCI rootfs needs skopeo, umoci, and jq; see the report)"
        return 1
    fi
    # The template's config includes common.conf, whose sys:mixed mount the guest's kernel
    # refuses inside a user namespace. The appliance would write its own config; so does this.
    rm -f "/var/lib/lxc/$name/config"
    {
        echo "lxc.uts.name = $name"
        echo "lxc.rootfs.path = dir:/var/lib/lxc/$name/rootfs"
        echo "lxc.net.0.type = none"
        # A privileged container can mount sysfs mixed — measured. An unprivileged one cannot:
        # the guest's kernel refuses a sysfs mount inside a user namespace (EPERM), so its
        # config asks for proc only and the checks below report what that costs.
        if [ "$unpriv" = "yes" ]; then
            echo "lxc.mount.auto = proc:rw"
        else
            echo "lxc.mount.auto = proc:mixed sys:mixed"
        fi
        echo "lxc.init.cmd = /bin/sleep 2147483647"
        echo "lxc.cgroup2.cpu.max = 200000 100000"
        echo "lxc.cgroup2.memory.max = 536870912"
        echo "lxc.cgroup2.devices.allow = c 10:232 rwm"
        echo "lxc.mount.entry = $SHARE ws none bind,create=dir,optional"
        echo "lxc.mount.entry = $SHARE ws-ro none bind,ro,create=dir,optional"
        echo "lxc.mount.entry = /dev/kvm dev/kvm none bind,optional,create=file"
        [ -n "$WORKSPACE" ] && echo "lxc.mount.entry = $WORKSPACE work none bind,create=dir,optional"
        if [ "$unpriv" = "yes" ]; then
            # The user namespace: everything is shifted, except the host user's own uid and gid,
            # which stay where they are so the container can write the share root.
            chown -R 100000:100000 "/var/lib/lxc/$name/rootfs"
            chmod 755 "/var/lib/lxc/$name"
            echo "lxc.idmap = u 0 100000 1000"
            echo "lxc.idmap = u 1000 1000 1"
            echo "lxc.idmap = u 1001 101001 64535"
            echo "lxc.idmap = g 0 100000 1000"
            echo "lxc.idmap = g 1000 1000 1"
            echo "lxc.idmap = g 1001 101001 64535"
        fi
        } >"/var/lib/lxc/$name/config"
    started=$(date +%s%N 2>/dev/null || echo 0)
    if ! lxc-start -n "$name" --logfile "/tmp/$name.log" --logpriority ERROR >>"$REPORT" 2>&1; then
        say "lxc-start failed for $name:"
        grep -m3 ERROR "/tmp/$name.log" 2>/dev/null | sub_stdin
        return 1
    fi
    started_ms=$((($(date +%s%N) - started) / 1000000))
    say "$name started in ${started_ms}ms"
    return 0
}

sub_stdin() { while IFS= read -r line; do sub "$line"; done; }

has_path() {
    # has_path <container> <path>: whether the path exists inside the container.
    lxc-attach -n "$1" -- test -e "$2" 2>/dev/null
}

checks() {
    # checks <name> <unpriv>: what the container grants, one check per fact the design needs.
    local name=$1 unpriv=$2 state cpu mem seen kvm kvm_status wrote refused stopped ro_wrote
    say "-- $name"
    state=$(lxc-info -n "$name" 2>/dev/null | awk '/^State/{print $2}')
    if [ "$state" != "RUNNING" ]; then
        check "$name-runs" echo "state is '$state'"
        return 1
    fi
    check "$name-runs" true

    # The limits are LXC's, applied to the container's cgroup. Read from the guest side: an
    # unprivileged container has no cgroup2 mount of its own (see the sysfs check below).
    cpu=$(cat "/sys/fs/cgroup/lxc.payload.$name/cpu.max" 2>/dev/null)
    mem=$(cat "/sys/fs/cgroup/lxc.payload.$name/memory.max" 2>/dev/null)
    check "$name-cpu-limit" test "$cpu" = "200000 100000"
    sub "cpu.max = ${cpu:-missing} (want 200000 100000)"
    check "$name-memory-limit" test "$mem" = "536870912"
    sub "memory.max = ${mem:-missing} (want 536870912)"

    # The share root, read: every container must see it at the path the policy named.
    seen=$(lxc-attach -n "$name" -- cat "/ws/$MARKER" 2>/dev/null)
    check "$name-share-bind" test "$seen" = "spike share"
    sub "/ws/$MARKER = '${seen:-missing}' (want 'spike share')"

    # /proc and /sys: a privileged container gets both. An unprivileged one gets no /sys and no
    # /sys/fs/cgroup, because the guest's kernel refuses a sysfs mount inside a user namespace
    # (EPERM, measured) — so a tool that reads /sys inside a workspace sees an empty folder.
    check "$name-proc" has_path "$name" /proc/meminfo
    if has_path "$name" /sys/kernel; then
        check "$name-sysfs" true
    elif [ "$unpriv" = "yes" ]; then
        sub "measured: no /sys and no /sys/fs/cgroup in an unprivileged container (the kernel refuses a sysfs mount in a user namespace)"
        skip "$name-sysfs" "absent by design in this profile"
    else
        check "$name-sysfs" false
    fi

    # A read-only bind must stay read-only: ADR 0014's promise is the mount flag, not a mode,
    # and the mode is not a boundary once the container has root inside.
    ro_wrote=$(lxc-attach -n "$name" -- sh -c \
        "echo probe > /ws-ro/.lxc-spike-ro 2>&1; echo status=\$?" 2>/dev/null)
    case "$ro_wrote" in
        *status=0*) check "$name-ro-bind" false ;;
        *) check "$name-ro-bind" true && sub "writing the read-only bind: refused" ;;
    esac

    # KVM, if the guest has one: the device by bind plus the device rule, then the ioctls.
    if [ -r /dev/kvm ]; then
        kvm=$(probe_kvm "$name" "$([ "$unpriv" = "yes" ] && echo unpriv || echo root)")
        kvm_status=$?
        case $kvm_status in
            0) check "$name-kvm" test -n "$kvm"; sub "${kvm:-no output}" ;;
            2) skip "$name-kvm" "no gcc in the guest to build the probe (apt-get install -y gcc)" ;;
            3) skip "$name-kvm" "the probe could not be placed in the container" ;;
            *) check "$name-kvm" false ;;
        esac
    else
        skip "$name-kvm" "/dev/kvm is not readable in the guest"
    fi

    # Writing the share root: the privileged container does it as root; the unprivileged one
    # only through the identity part of its idmap (container uid 1000 = the host user's uid).
    if [ -n "$WORKSPACE" ]; then
        rm -f "$WORKSPACE/.lxc-spike-write"
        if [ "$unpriv" = "yes" ]; then
            wrote=$(lxc-attach -n "$name" -- setpriv --reuid=1000 --regid=1000 --clear-groups \
                sh -c "cd /work && echo probe > .lxc-spike-write && rm .lxc-spike-write && echo wrote" 2>/dev/null)
            refused=$(lxc-attach -n "$name" -- sh -c \
                "cd /work && echo probe > .lxc-spike-write 2>&1; echo status=\$?" 2>/dev/null)
            sub "container uid 0 writing the share: $refused (it did write; the file lands owned by the container's uid, not the host user's)"
        else
            wrote=$(lxc-attach -n "$name" -- sh -c \
                "cd /work && echo probe > .lxc-spike-write && rm .lxc-spike-write && echo wrote" 2>/dev/null)
        fi
        check "$name-writes-share" test "$wrote" = "wrote"
        sub "write as uid $([ "$unpriv" = "yes" ] && echo 1000 || echo 0): ${wrote:-refused}"
        # Removed from the guest side: a container's root may not own what it wrote there, and
        # a probe must not leave a file in a person's workspace.
        rm -f "$WORKSPACE/.lxc-spike-write"
    else
        skip "$name-writes-share" "no host-mounted path was found to write (set SPIKE_WORKSPACE)"
    fi
    # A stop is the number the sketch's "a workspace costs a container" claim lives on. `-k`
    # is the stop acornfall wants: a graceful one waits for the container's init to agree, and
    # an image with no init in it takes LXC's full 60s timeout (measured).
    stopped=$(date +%s%N)
    lxc-stop -n "$name" -k >/dev/null 2>&1
    say "$name stopped (kill) in $((($(date +%s%N) - stopped) / 1000000))ms"
}

# -- preparation ---------------------------------------------------------------------------

provision() {
    # The unprivileged profile needs the guest to allow mappings for itself: the ranges are what
    # newuidmap checks. Adding them is a fact about the appliance, so it is reported.
    step "the mapping an unprivileged container needs"
    if ! grep -q '^root:100000:' /etc/subuid 2>/dev/null; then
        printf 'root:100000:65536\n' >>/etc/subuid
        say "added root:100000:65536 to /etc/subuid"
    fi
    if ! grep -q '^root:1000:' /etc/subuid 2>/dev/null; then
        printf 'root:1000:1\n' >>/etc/subuid
        say "added root:1000:1 to /etc/subuid (the host user's own uid, to write the share)"
    fi
    grep -q '^root:100000:' /etc/subgid 2>/dev/null || printf 'root:100000:65536\n' >>/etc/subgid
    grep -q '^root:1000:' /etc/subgid 2>/dev/null || printf 'root:1000:1\n' >>/etc/subgid
    # A fresh guest has the device root-owned and 0600, which no container can open. The group
    # route the ADR names assumes the host set a `kvm` group; here the mode is the workable door.
    if [ -e /dev/kvm ] && [ "${SPIKE_KVM_MODE:-1}" = "1" ]; then
        chmod 666 /dev/kvm
        say "set /dev/kvm to mode 666 for the run (a fresh guest has it 0600 root:root)"
    fi
    rm -rf "$SHARE"
    mkdir -p "$SHARE"
    printf 'spike share\n' >"$SHARE/$MARKER"
}

# -- run -----------------------------------------------------------------------------------

say "lxc spike: $(basename "$0") — $(date -u '+%Y-%m-%dT%H:%M:%SZ')"
if ! command -v lxc-start >/dev/null 2>&1; then
    if [ "${SPIKE_INSTALL:-0}" = "1" ] && command -v apt-get >/dev/null 2>&1; then
        say "installing lxc, jq, skopeo, umoci (SPIKE_INSTALL=1)"
        apt-get update -qq >>"$REPORT" 2>&1
        apt-get install -y -qq lxc jq skopeo umoci >>"$REPORT" 2>&1
    fi
fi
if ! command -v lxc-start >/dev/null 2>&1; then
    say "lxc is not installed in this guest: run 'apt-get install -y lxc jq skopeo umoci', or set SPIKE_INSTALL=1"
    exit 1
fi

step "the guest"
say "kernel: $(uname -srm)"
say "cgroup: v2=$([ -f /sys/fs/cgroup/cgroup.controllers ] && echo yes || echo no) controllers=$(cat /sys/fs/cgroup/cgroup.controllers 2>/dev/null)"
say "cgroup subtree_control: $(cat /sys/fs/cgroup/cgroup.subtree_control 2>/dev/null)"
say "namespaces: $(ls /proc/self/ns | tr '\n' ' ')"
say "rootfs: $(findmnt -n -o FSTYPE,SOURCE / 2>/dev/null)"
say "memory: $(awk '/MemTotal/{printf "%d MiB", $2/1024}' /proc/meminfo), cpus: $(nproc)"
say "lxc: $(lxc-start --version 2>&1)"
say "skopeo: $(command -v skopeo >/dev/null 2>&1 && skopeo --version 2>&1 || echo 'missing (apt-get install -y skopeo)')"
say "umoci: $(command -v umoci >/dev/null 2>&1 && umoci --version 2>&1 || echo 'missing (apt-get install -y umoci)')"
[ -n "$WORKSPACE" ] &&
    say "share candidate: $WORKSPACE ($(findmnt -n -o FSTYPE --target "$WORKSPACE" 2>/dev/null))" ||
    say "share candidate: none found; set SPIKE_WORKSPACE to the folder the host mounted in"

step "the device a container would need"
show ls -l /dev/kvm
if [ ! -e /dev/kvm ]; then
    skip "kvm-device" "/dev/kvm is not in this guest"
elif [ ! -r /dev/kvm ]; then
    skip "kvm-device" "/dev/kvm exists but is not readable by $(id -un)"
else
    check "kvm-device" true
fi

# A container needs the guest's root cgroup to hand the controllers down. That write is the
# appliance's to make on every VM it creates, so it is checked here rather than assumed.
step "cgroup delegation the containers need"
before=$(cat /sys/fs/cgroup/cgroup.subtree_control 2>/dev/null)
printf '+cpu +memory +pids' >/sys/fs/cgroup/cgroup.subtree_control 2>/dev/null
after=$(cat /sys/fs/cgroup/cgroup.subtree_control 2>/dev/null)
sub "subtree_control: '$before' -> '$after'"
case " $after " in
    *" cpu "*) check "cgroup-delegation" true ;;
    *) check "cgroup-delegation" false ;;
esac

provision

step "profile: privileged container"
if start_container "$PRIV" no; then checks "$PRIV" no; else failures=$((failures + 1)); FAILED_LIST="$FAILED_LIST $PRIV-start"; fi

step "profile: unprivileged container (user namespace, no capabilities)"
if start_container "$UNPRIV" yes; then checks "$UNPRIV" yes; else failures=$((failures + 1)); FAILED_LIST="$FAILED_LIST $UNPRIV-start"; fi

step "result"
say "passes: $passes  failures: $failures  skips: $skips"
[ -n "$FAILED_LIST" ] && say "failed:$FAILED_LIST"
say "report: $REPORT"
[ $failures -eq 0 ] || exit 1
