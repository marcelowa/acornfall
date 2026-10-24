# 0034. A workspace installs its tools into a prefix

Status: proposed, 2026-10-24 — the mechanism is built (`Policy.Prefixes`, `prefixBind`,
`ensureBindSource`) and pinned by unit tests; the live proof is the release-boot test
(`TestLiveTheApplianceBootsFromItsReleaseTarball`), which installs a tool into `/usr/local` and
reads it back from the share. The two open questions at the end are the owner's.
Date: 2026-10-24

## Context

ADR 0021 gave a workspace an unprivileged LXC container, and named the price in the same breath:
`CapEff 0`, no `mount`, no `iptables`, no device nodes — and, because there is no root, no
`apt-get install`. ADR 0023 kept the default unprivileged on purpose, refusing a privileged
container as the fix for a missing device node.

What that costs in practice is measured, on this repository's own development workspace
(`0.10.0-beta.54`):

| Fact | Value |
|---|---|
| packages in the image | 78 (`debian:stable-slim`, `DefaultImage`) |
| `ca-certificates`, `curl`, `git`, `gcc`, `make`, `sudo` | absent |
| `/usr/local`, `/opt`, `/etc` | not writable by the workspace's uid |
| capabilities | `CapEff 0000000000000000` |
| `/sys/fs/cgroup` | absent (ADR 0021's measured cost) |
| getting a toolchain | unpacking `.deb`s by hand into the workspace |

Setting that container up took a hand-built `LD_PRELOAD` NSS shim, a CA bundle assembled from
the `ca-certificates` package and a rewritten `libc.so` linker script. None of that is the
product's fault — it is what "unprivileged and nothing installed" means — but it is the wrong
experience for the only environment the model's tools ever run in, and a user cannot be asked to
do it.

Three answers were considered and two refused:

- **A bigger image.** It moves the list of tools somebody guessed, and the guess is always
  wrong. It also does nothing for the next tool a workspace needs.
- **Run the container privileged (ADR 0021's open question).** It works, and it is now
  expensive in a way it was not before ADR 0022: the provider key lives in the mount, a
  privileged container's root is the machine's root, so "give the workspace root" has become
  "let the agent read its own credential" (ADR 0022, "The price", still open).
- **A writable prefix.** The one that fits both ADRs: the container stays unprivileged, and the
  toolchain arrives by a path the shell already searches.

## Decision

1. **A prefix is a bind of a share folder at a fixed system path**, read-write. It is the only
   bind whose two sides differ, and the render path already writes them separately
   (`lxc.mount.entry = <source> usr/local none bind,create=dir,optional`) — `bindPath` was the
   only thing collapsing them.
2. **The targets are a closed set**: `/usr/local` and `/opt`, in `PrefixTargets`. `/usr/local`
   is where a toolchain looks by default; `/opt` is where a self-contained install goes. `/usr`,
   `/etc`, `/bin`, `/lib` are refused by name: a bind that can replace the image's own programs
   or its resolver configuration is a different threat from installing tools.
3. **A prefix source obeys the share-root rule** like every other bind — inside the root, never
   the root, never `config/` or `state/`. A prefix is not a way around ADR 0022's decision 5.
4. **Every workspace gets two by default** (`DefaultPrefixes`): `<workspace>/.acornfall/prefix/usr`
   → `/usr/local` and `.../opt` → `/opt`. Deriving them in `SandboxPolicy` is what keeps a new
   field from being forgotten in one of the two places.
5. **A missing source is made, not skipped.** The runtime skips a mount whose source is absent
   (`optional`), silently, so `ensureBindSource` creates the folder before the container is
   created and gives it to the share's owner. A prefix that mounts nowhere must be impossible,
   not merely unlikely.
6. **The default stays unprivileged.** A prefix is not a step toward `Privileged`; it is the
   answer that keeps `Privileged` unnecessary.

## What it buys

- **Installing a tool needs no root.** Measured in a workspace with `CapEff 0` and uid 999: a
  release tarball unpacked into a share-owned prefix ran, and did real work.
- **The toolchain survives what the rootfs does not.** `/proc/self/mountinfo` shows `/` coming
  from `/var/lib/lxc/<name>/rootfs` and the workspace coming from the share over virtiofs, so a
  container recreated from its image keeps nothing it installed in the rootfs and keeps
  everything it installed in the prefix.
- **It is per workspace.** One workspace's install cannot poison another's: the source is that
  workspace's own folder.
- **Nothing new is trusted.** The worker is in the machine and never reads the prefix; the bind
  target is inside the container's own rootfs.

## The price

- **`apt` is still impossible.** A prefix is not a package manager: it is where a binary goes.
  Anything that must write `/usr/lib`, install init scripts, or register with `dpkg` stays out
  of reach. The tools that matter for development — Go, Rust, Node, Python, `bun`, `uv`, `mise`,
  `nix`, and every static release tarball — do not need it.
- **`/usr/local` is shadowed.** In `debian:stable-slim` it holds 11 empty directories and no
  files (measured), so nothing is lost. An image that ships something in `/usr/local` would have
  it hidden.
- **The prefix lives in the workspace, so it lands in the user's folder.** `<workspace>/.acornfall/`
  is ignored by this repository, and by convention in the ones that already use it — but a
  stranger's repository will show it as untracked, and a careless `git add -A` commits a
  toolchain. This is the open question below.
- **Disk is the user's.** A prefix is inside the folder they back up.

## Alternatives

- **`--privileged` for workspaces that need tools** — refused here; ADR 0022's price is the key.
- **An image with everything** — moves the guess, and the guess is wrong.
- **An overlay on the image's `/usr`** — an overlay keeps the image's files and adds to them,
  which is strictly nicer than shadowing `/usr/local`, and it needs a mount the unprivileged
  profile cannot make. It would be a reason to revisit the profile, not a reason to use one.
- **Nix / `mise` / `uv` inside the workspace** — they work today, without a prefix, and several
  are what a user would install *into* one. A prefix is the mechanism; those are the contents.

## Consequences

- `Policy.Prefixes`, `Prefix`, `PrefixTargets`, `DefaultPrefixes` (`internal/sandbox/policy.go`);
  `prefixBind` (`layers.go`); `ensureBindSource` (`lxcengine.go`); the derivation in
  `control.Workspaces.SandboxPolicy`.
- The shim needed no change: `prepareTarget` already makes a target that does not exist, chowns
  it to the share's owner, and gives its ancestors execute permission (ADR 0021's "the parent
  folders have to exist" finding, already answered).
- Tests: the target set, the share-root rule, the default shape, and the derivation — plus the
  release-boot test, which is where a bind that does not land is caught.

## Open questions

1. **Where the prefix lives.** `<workspace>/.acornfall/prefix/` keeps the toolchain in the
   workspace — one folder to back up, gone when the workspace goes — and pollutes the `git
   status` of every repository that does not ignore it. The alternative is a folder under the
   share root (`<share>/prefixes/<name>/`), which is clean for git and adds a fifth top-level
   folder to the layout ADR 0022 fixed. This beta does the first; the second is the better
   answer if the layout can carry it.
2. **Whether a workspace may turn it off.** Today every workspace gets both prefixes and there
   is no switch. A workspace that wants `/usr/local` to be the image's — to test what the image
   actually ships — cannot say so.
