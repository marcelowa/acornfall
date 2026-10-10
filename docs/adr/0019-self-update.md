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
alone. Clean wipes the sandbox root only, never files under workspaces.
Needed when the VM format or the engine changes.

**Migrate at boot, from scripts.** New binary runs `migrate --to <tag>`
before serving. One script per release in `scripts/migrate/`, e.g.
`v0.9.0.sh`. Non-zero exit stops boot and starts rollback. No silent
fix-ups in app code.

**Last good binary stays.** `acornfall.bak` plus a version file.
`GET /healthz` must pass for 30s after start. Fail means stop the new
build, start the old one, show the cause on the update screen.

**Roles now, enforced later.** Today one user, same rights. The API
carries the role check now: `POST /api/update/apply` answers 403 for
non-admin. Default allow.

## API (v1)

- `GET /healthz` -> `{ ok: true, version }`
- `GET /api/update/status` -> `{ current, latest, notes, pinned, checking }`
- `POST /api/update/check` -> force a check now
- `POST /api/update/apply` -> `{ cleanVMs, drain: "wait"|"stop" }`
- `POST /api/update/rollback` -> restore the last good build
- Events over the state stream: `update.available`, `update.progress`,
  `update.failed`

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
- UI: header dot (count 1), update screen (current tag, new tag, notes,
  size/risk, backup note), blocking-runs dialog (wait default, stop,
  cancel), Settings > Updates tab (channel, auto-check, pinned tag).
- Docs: README runbook + pin policy.
- Tests: check parsing, backup rotation, migrate fail stops boot,
  rollback restores, health gate, role 403, UI renders with and
  without an update.

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

- The worker ships compiled (`bun build --compile`), one binary per
  OS/arch next to the gateway: no bun, no sources, no `node_modules`
  at runtime. Dev keeps `bun run src/main.ts`; `--worker` wins, then
  `--worker-bin`, then the beside-the-binary worker, then bun.
- Migrate scripts are baked into the gateway (`go:embed`);
  `--migrate-dir` overrides for script authors.
- Update downloads and verifies both binaries against one checksum file
  and swaps worker first, gateway second. Releases before the worker
  asset skip the worker step.
- Everything lives under the install folder. The host stays clean.
