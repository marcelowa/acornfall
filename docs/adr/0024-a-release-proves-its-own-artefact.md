# ADR 0024 — A release proves its own artefact

Status: accepted, 2026-10-21
Date: 2026-10-21

## Context

Two betas shipped an appliance image that could not boot. The tests were green for both,
because every live test booted a **directory** built by `scripts/build-appliance.sh`, and a release
ships a **tarball**. The two differ exactly in what tar carries: symlinks, hard links, device nodes.

The first image lost every symlink in the unpacker, and `/bin/sh` on Debian is one, so the machine
said `handoff init binary not found at /bin/sh` — a message about the image, for a fault in the
unpacker. The second had an empty `/dev`, because a tarball made by an unprivileged builder carries
no device nodes and nothing made them at boot; the machine said `open_devnull: Operation not
permitted` and ran the command anyway. Both were found by a person installing a beta. No job in the
pipeline ever touched the bytes that person downloaded.

That is the whole failure: the claim "the tests pass" was about a different object than the one
shipped. It was not a gap in coverage — the tests were thorough about the wrong artefact.

## Decision

1. **The proof runs on the released bytes.** The `prove` job in `.github/workflows/release.yml`
   needs `publish`, then downloads `acornfall-linux-amd64` and `appliance-linux-amd64.tar.gz` back
   from the GitHub release, by tag. It deliberately does not use the job's own artifacts: what a
   person downloads is the thing to boot.

2. **It boots the way a person does.** `machine up` with the published binary, as the runner's
   ordinary user, and then `/api/state` must answer on `127.0.0.1:7777` — the address the launcher
   prints. No root, no build tree. The unprivileged install the docs promise, executed.

3. **It unpacks with the install's own unpacker.** The test
   `TestLiveTheApplianceBootsFromItsReleaseTarball` calls `update.UnpackAppliance` — the same
   function `machine up` uses — on the published tarball, asserts `/bin/sh` exists in what came out,
   boots it, and waits for the console. The `/bin/sh` assertion is there because it is the exact
   thing that broke.

4. **What the proof claims is bounded on purpose.** It claims the console answers. It does not wait
   for a container: a machine has no container until a turn asks for one, so waiting for `RUNNING`
   waits forever (measured in CI). The container is the other live test's question.

5. **The same boot runs on a branch push.** `prove.yml` boots the appliance the release job left on
   the runner's disk, keyed by a hash of the appliance's inputs, in minutes rather than a tag's half
   hour. A hash the runner has not seen warns and skips the boot — the next tag builds and proves.
   (Making it build on a miss is the next change; it is the one hole in this.)

6. **A failed proof does not unpublish.** The release is public the moment it is published; a red
   `prove` is the alarm, and the repair is a new tag.

## Alternatives

- **Keep booting the built directory** — what shipped both broken betas. It cannot fail for either
  of the two reasons a release failed.
- **Build the tarball inside the test** — proves the builder, not the shipped bytes. The unpack
  path, the checksums and the release upload all stay untested.
- **Gate the publish on the proof** — build → prove → publish, so no broken release is ever public.
  Not chosen: every failed proof would become a publish that never happened, and the artefacts would
  move twice (the appliance alone is 193 MiB). Worth revisiting if a broken release ever reaches
  someone twice.
- **A person smoke-testing before a tag** — the person installing the beta was the smoke test,
  twice, and both times the report was a broken install.
- **Trust the artifact from the same run** — the artifact is what the build produced; the release
  asset is what a person downloads. The round trip through the release is the whole point.

## Consequences

- A tag is now ~35 minutes, most of it the proof. That is the cost of the claim, and it is why the
  branch loop exists: fixes are tested there, tags are for releases.
- A green `prove` is narrower than "the release works": it says the tarball's bytes boot on the
  published binary and serve the console. Containers, tools, and models are other claims with other
  tests.
- **A hash the runner has not seen makes the branch loop green and empty.** The job warns and skips
  the boot, so `prove` succeeds without booting anything — the same shape of claim this ADR exists
  to kill. Every change to `gateway/**`, `worker/src/**` or the build script changes the hash, so
  after a code change only a tag produces an appliance for the runner to boot. Building on a miss
  is the next change, and until it lands a green `prove` on a push is not evidence that anything
  booted.
- The unpacker now has two callers that matter (`machine up`, the proof), so its symlink and
  hard-link handling is pinned by `TestTheImageKeepsItsSymlinksAndItsLinks`.
- The proof reads the release API with `python3`, because this runner has no `jq` — its first
  finding was about itself (beta 4).
- The appliance is still stored as a 193 MiB artifact per release. The proof reads the release, not
  the artifact, so the artifact is now only a hand-off between jobs — and the next change removes it
  by uploading straight to a draft release.
