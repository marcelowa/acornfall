# ADR 0026 — An appliance image names the release it is

Status: accepted, 2026-10-21
Date: 2026-10-21

## Context

`machine up` fetches the appliance when the image is missing, and until now it kept any image whose
two files were present (`checkAppliance`). The image is the machine's disk, so an upgrade booted the
**previous** appliance — and, with it, the containers a previous machine had left in `var/lib/lxc`.

On the owner's box (a Proxmox VM, `acornd`) that produced "this workspace has no sandbox" on a
machine whose container `lxc-ls` reported as RUNNING, and the only cure was a clean install. The
clean install replaced the image; nothing in `machine up` ever replaced a byte. That is why the cure
kept being true and the bug kept coming back.

An image is a tarball of files. Two trees from two releases differ in bytes, but nothing in them
*reads* as a release: the file `checkAppliance` looks for is identical in both.

The shim's `list` was the other half: one container the runtime could not answer for failed the
whole call, and `Produce` turned that into "no sandbox" for every workspace at once. That is fixed
beside this (`docs/features.md`, M2) and neither half is sufficient alone: a resilient list still
boots the wrong product, and a fresh image still left that failure waiting for the next bad
container.

## Decision

1. **The image names the release it is** in `/etc/acornfall-appliance`. The build writes it when CI
   tells it the tag (`VERSION=${{ github.ref_name }}`), and the launcher stamps it after a fetch,
   because it verified that release's checksum — the launcher knows which bytes it unpacked even
   when the image is older than this convention.
2. **`machine up` replaces an image that does not say the release this build runs**, including every
   image built before the mark carried one. A replaced image is a machine that has to be made again:
   an init is fixed at boot, and the new image arrives without the old containers.
3. **A named image is the person's own tree** (`--image`): never compared, never replaced. It is how
   a hand-built appliance or a lab image is booted.
4. **A source build has no release to be**, so it keeps the image it has: a tag that does not name a
   release (`dev`) is not a comparison anyone can make.
5. **A fetch that cannot happen keeps the image that is there**, with a line saying it is not the
   release this launcher runs. An install whose network is down is a machine that still boots.

## Alternatives

- **Keep the image and fix only the shim's list.** Not enough: the machine was running a product
  that was not the launcher's, with containers from a machine that no longer existed. A launcher
  that silently boots another release is its own bug.
- **Compare checksums of the unpacked image.** There is no manifest to compare against; the tarball
  is gone once it is unpacked, and the tree has mtimes and device nodes the tarball does not.
- **Always refetch on `machine up`.** 155 MB per boot, and no offline install.
- **Refuse to boot when the image is not this launcher's release.** An offline or rate-limited
  install could not start at all — and the GitHub API rate limit is a real state from a shared
  address (measured: `403`, one hour's sixty requests spent).
- **Clean `var/lib/lxc` on every `machine up`.** Deletes containers from a machine that is fine, and
  leaves the product/image mismatch in place.

## Consequences

- Upgrading costs one appliance download, and the machine is made again: containers are lost, the
  mount is not. The product's files, the key and the token live in the mount (ADR 0022).
- An image from before the mark is replaced once; after that it says which release it is, and a
  `machine up` with the same release fetches nothing.
- `machine up` can reach the network on an existing install — only when the image is not this
  release's, and a failure is a warning rather than a refusal.
- The mark is also what a person reads:
  `cat ~/.acornfall/appliance/rootfs/etc/acornfall-appliance`.
- The build script takes `VERSION`, so a hand build can name its release: `VERSION=v0.10.0 ./scripts/build-appliance.sh`.
  A hand build that does not is stamped by the launcher when it fetches one, not when it is given
  with `--image`.
- The image that shipped as beta.13 carries no release: its build ran before CI passed `VERSION`
  into the builder machine (`msb exec` carries the command, not the step's environment). The
  launcher stamped it on the machine that fetched it — which is the path every install takes, and
  the release's own proof shows it — and the next appliance carries the mark from the build.
