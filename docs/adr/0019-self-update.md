# ADR 0019 — Self-update from the header: releases, backup, migrate, rollback

Status: accepted, in progress
Date: 2026-10-10

## Context

The install runs an old build and nobody says so. Single user now, admin
later. Goal: the header shows one dot, one screen explains the release,
one click updates. A failed update returns to the last good build.
The UI never lands dead.

Prior work: workspaces own one worker each ([ADR 0011](0011-workspaces.md)).
The host engine is explicit and never a fallback
([ADR 0015](0015-host-engine.md)). This ADR adds the update tier on the
same terms: explicit, gated, reversible.

## Decision

**GitHub releases first, tree builds second.** v1 reads
`https://api.github.com/repos/marcelowa/acornfall/releases/latest` only.
Tag shape `v0.9.0`. Notes come from the tag message. A second channel
`main` (local `git pull + make build`, dev hosts only) lands later.
Reason: releases are tested and checksummed. Tree builds break often
and hide which commit runs.

**Check once per hour, plus a manual Refresh.** The gateway owns the
schedule. The answer is cached: current tag, new tag, notes, pinned,
checking. Pinned tag means no prompts.

**Backup before update, or no update.** Config, state DB, workspace
list. Last 3 kept. No VM disk backup in v1 (too big); the screen says
so. Backup failure stops the update.

**Keep VMs by default, clean on ask.** Keep leaves the sandbox root
alone. Clean removes every workspace sandbox and empties the engine
state dir (images re-pull), never files under workspaces. The engine
install itself stays. Needed when the VM format or the engine changes.

**Migrate at boot, from scripts.** New binary runs `migrate --to <tag>`
before serving. One script per release in `scripts/migrate/`, e.g.
`v0.9.0.sh`. Non-zero exit stops boot and starts rollback. No silent
fix-ups in app code.

**Last good binary stays.** `acornfall.bak` plus a version file.
Staged binaries must execute (`version` names the tag) before swapping.
`GET /healthz` names the build; the 30s must-pass window after start is
the operator's (service restart on failure), not the gateway's. Migrate
failure still stops boot and rolls back by itself.

**One click finishes.** Apply answers, then the process becomes the new
binary itself (same PID, args, environment): no manual restart step.
Workers stop first — an orphan would serve old code past the exec and
resurrect wiped sandboxes — and warm sandboxes stay for reattach.
Exec failure keeps the old process and the manual path.

**The update screen is a page, and the picker installs a version.** The
screen keeps its own URL, for the same reason every other screen does:
a reload and a shared link land where someone was. The picker lists the
last twenty releases, newest first, and a pick installs that tag once —
it does not pin. Pinning stays its own field, because it means "stop
asking" and a pick that set it would stop every later prompt. A picked
release older than the running build is marked as such, and stays
installable for now; whether the migration record should refuse one is
deferred until the record exists. The header says the newest GA's tag
beside the dot when there is room, and a bare dot on a phone.

**Roles now, enforced later.** Today one user, same rights. The API
carries the role check now: `POST /api/update/apply` answers 403 for
non-admin. Default allow.

## API (v1)

- `GET /healthz` -> `{ ok: true, version }`
- `GET /api/update/status` -> `{ current, latest, notes, pinned, checking }`
- `GET /api/update/releases?limit=20&prerelease` ->
  `{ releases: [{ tag, name, notes, publishedAt, prerelease, downloadSize,
  workerSize }] }`, newest first by tag. GA only; the `prerelease`
  parameter widens the list for one visit, because that switch is not a
  setting. Drafts never appear. Added for the update screen's picker:
  the last twenty releases are selectable, not only latest.
- `GET /api/update/releases/{tag}` -> one release, by name, notes
  resolved: the version page outside the twenty, and the running row.
  `404` when the source has no such release.
- `POST /api/update/check` -> force a check now
- `POST /api/update/apply` -> `{ cleanVMs, drain: "wait"|"stop", tag }`.
  An empty `tag` installs the release the check found — the indicator's
  one-click path. A tag installs that release by name (404 when the
  source has none). Drain stop aborts runs; the stop lands after the
  download verifies and before anything moves, so a failed download
  costs no runs, and the gate is read again there. A second apply before
  restart refuses (409).
- `POST /api/update/restart` -> finish a pending update: the files are
  swapped and the old process still answers, so the process replaces
  itself with the binary on disk. 403 for non-admins.
- `GET /api/update/status` also carries `runsActive` and `runs
  [{ workspace, runs }]`: what stopping runs would stop, from the
  gateway, not from the workspace in view.
- `POST /api/update/rollback` -> restore the last good build
- The state stream carries `{ current, latest, available, failed,
  restartRequired }`: the header dot without fetching. Per-event
  `update.available/progress/failed` frames were sketched and dropped —
  the polled status plus the state summary cover every screen.

## Alternatives

**Auto-install without ask.** Rejected: the user runs work in
sandboxes; a restart mid-run loses it. The screen asks, runs block.

**Delta patches.** Rejected for v1: full binary replace is simple to
verify and to roll back. Deltas save bytes and cost a second format.

**VM disk backup.** Rejected for v1: too big, rarely needed. Keep VMs
covers the common case; clean covers format changes.

**Tree builds first.** Rejected: see Decision. They stay as the later
`main` channel for dev hosts.

## Consequences

- Gateway: `internal/update` owns version file, check job, backup set,
  migrate runner, health-gated switch, rollback. Boot runs pending
  migrations before serving.
- UI: the bar's update mark (the newest GA's tag beside it on a desktop, the
  mark alone on a phone, restart pending in the same spot), the release page
  at `/update` and `/update/<tag>` (running build, target, notes, the changes
  in between, size/risk, backup note, the keep/clean choice, Install), the
  picker of the last twenty with a per-visit pre-release switch, the runs
  dialog (Not now, stop runs and install, cancel — with what stopping would
  stop named), and settings' install-wide page (running build, auto-check,
  and the Releases door). The Updates tab and the pin are gone: the indicator
  follows the newest GA with nothing able to silence it, and a pick installs
  once.
- Notes: the release body is the tag message (the workflow writes it); a null
  body — every release cut before 2026-10-15 — falls back to the tag
  annotation (`/git/ref/tags/<tag>` then `/git/tags/<sha>`), so "what changed"
  has a source for every release.
- Docs: README runbook.
- Tests: check parsing, backup rotation, migrate fail stops boot, rollback
  restores, health gate, role 403, release list and by-name reads, notes from
  the tag annotation, runs stop after the download verifies, UI renders with
  and without an update.

## Open (asked, not decided)

- Release asset shape: decided binary per OS (`acornfall-<goos>-<goarch>`).
- Checksum verify: checksum file (`sha256sums.txt`) for v1; minisign later
  when releases are public and scripted. Cosign rejected: heavy for one file.
- Private repo auth: `ACORNFALL_GITHUB_TOKEN` (fine-grained, read-only,
  this repo) while the repo is private; dropped when releases go public.

## Live drill (v0.9.0, 2026-10-10)

- Downloads go through the asset API (`/releases/assets/<id>` + octet
  accept): browser URLs 404 on private repos with a Bearer token.
- Swap and rollback rename instead of overwrite: a running binary answers
  ETXTBSY to a write but renames aside fine (Linux, macOS).

## Self-contained releases

- The worker ships as sources (`worker.tar.gz`: package.json, bun.lock,
  src), never `node_modules`. Compiled was tried and rejected: the
  sandbox SDK is a native module no bundler inlines, so the binary
  crashes where it matters most.
- The gateway ensures a pinned bun under `<home>/tools` (downloaded
  once, version smoke-tested) and installs dependencies under
  `<home>/worker` when the lockfile changes. Dev keeps system bun:
  `--worker` wins, then `--worker-bin`, then `--worker-dir`, then the
  managed path.
- Update downloads and verifies the tarball against the one checksum
  file and stages it; the new gateway unpacks (paths jailed), stamps
  VERSION, and installs at boot. Boot failures refuse loudly, never
  brick: migrate failure still stops boot, a missing toolchain only
  stops workers.
- Everything lives under the install folder. The host stays clean.
