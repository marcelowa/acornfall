# ADR 0013 — Test tiers: the fast default, the sandbox suite, and isolation

Status: accepted, built
Date: 2026-10-06

## Context

The full gate took **506s** on a machine with `/dev/kvm`. Most of it was not assertions but
the system under test: 41 end-to-end tests each start a gateway and a worker and wait for a
scripted model turn, and with the sandbox tier on every one of them boots the workspace's
microVM — all of it under `-race`. Measured:

| what | time |
|---|---|
| worker unit tests (fake sandbox client) | 0.5s |
| Go unit tests (fake driver) | ~0s |
| e2e, sandboxes off, serial | 112s |
| e2e, sandboxes off, `-parallel 6` | 33s |
| e2e, real sandboxes, serial | 183s |
| e2e, real sandboxes, `-parallel 6` | 85s, and four failures that moved between runs |
| `make test` (race + real sandboxes) | 506s |

Two things were wrong beyond the runtime. **The same command behaved differently on machines
with different capabilities** — it booted microVMs here and refused in CI, so a green run
proved different things in different places, and a test that should have caught a sandbox
regression could pass by skipping. And **the parallel failures were not the sandboxes**: the
harness cleanup ran `msb rm --label acornfall`, which removes every sandbox the install ever
made, so a test finishing deleted a parallel test's running VM. That is why the failures
moved between runs.

## Decision

**A slow piece gets its own suite and its own target; the default gate stays fast and
honest.**

- **`make test` is the fast tier.** `-short -race`, the worker units, the Go units, and the
  end-to-end suite with `ACORNFALL_NO_SANDBOX=1` and `-parallel 6`. It needs no hypervisor and
  behaves the same on every machine, including CI. Measured 33s against 506s.
- **`make test-sandbox` is the slow tier.** The same suites without `-short`, with
  `ACORNFALL_LIVE_SANDBOX=1` and the worker's `ACORNFALL_SANDBOX_INTEGRATION=1`, at low
  parallelism, sharing the image cache under `/tmp/acornfall-e2e-sandboxes`. It **fails**
  where there is no hypervisor rather than skipping: a slow tier that silently does nothing is
  how the bug class it exists for survives.
- **`testing.Short()` is the boundary**, and `maybeSandbox` is the one function that decides
  it. A test that needs the workspace's own files calls it and skips under `-short`; the rest
  of the end-to-end suite runs in both tiers.
- **"No sandbox" in the fast tier is the refusal path the product ships.** `ACORNFALL_NO_SANDBOX`
  makes the gateway build no sandbox tier at all — the same state as a machine without a
  hypervisor — so the tools refuse and the worker starts anyway. It is never a host-backed
  stand-in: an unconfined execution engine must not exist in the product for a test to select.
- **A test removes only what it created.** The end-to-end harness computes the sandbox names
  from the workspaces the test owns — its general folder plus its own workspaces directory —
  and removes exactly those. Nothing removes by label, and nothing deletes the shared image
  cache.
- **Parallel by default in the fast tier.** Each end-to-end test already owns its home, its
  workspaces folder, and an ephemeral port; the per-test cleanup is what makes the same true
  with sandboxes on.

## Alternatives

**Auto-detect the hypervisor and skip.** What the suite did before, and the reason one command
meant two things. Rejected: a gate whose depth depends on the machine cannot be trusted from
either side.

**Run tools on the host when a test asks for no sandbox.** Rejected: an unconfined tier is a
product feature, and nobody decided to build one. The switch that turns a sandbox off must
turn the tools off, or "the sandbox is always on" stops being true.

**Keep the real-sandbox tests in the default gate, serially.** 506s is a gate nobody runs; a
gate nobody runs is a gate that is not there. The cost of the real thing belongs in a target
whose name says what it costs.

**Label-based cleanup, made safe by unique labels.** Rejected in favour of the smaller rules:
a test already knows its home and its workspaces folder, so the names follow from what it owns
without inventing a second identity scheme, and the shared image cache keeps its own name out
of the removal list entirely.

**Bun's `-short`.** It has none, so the worker's real-SDK suite is gated by
`ACORNFALL_SANDBOX_INTEGRATION=1`, which `make test-sandbox` sets and `make test` does not.

## Consequences

- CI's push gate is `make test`; `make test-sandbox` is a `workflow_dispatch` job that takes
  the KVM-capable runner as an input, because GitHub-hosted runners have no `/dev/kvm`.
- The worker's own side of the real engine — streamed exec, killing a command, file
  operations — is now exercised directly, `worker/test/sandbox.integration.test.ts`, instead
  of only through the end-to-end suite.
- A workspace removed from the registry keeps its folder, so its sandbox name is still in the
  test's removal list. Removing what is already gone is a no-op, which is the deliberate price
  of never naming what the test does not own.
- Prepared images and snapshots are the next slow piece; they get a suite and a target in this
  same shape.
