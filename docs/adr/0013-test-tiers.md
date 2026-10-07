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

- **`make test` is the fast tier.** `-short -race`, the worker units, the Go units, the
  tests that need no engine at all against the refusal path, and the thirteen resource tests
  on the host engine ([ADR 0015](0015-host-engine.md)), one test per core (`TEST_PARALLEL`).
  It needs no hypervisor and behaves the same on every machine, including CI. Measured ~30s.
  Concurrency follows the machine because each test is a gateway and a worker under `-race`;
  six of those on a two-core CI runner starved the delegation tests, which now also get a
  two-minute deadline instead of sixty seconds — a bound for failing, not a target.
- **`make test-sandbox` is the engine boundary.** The live driver test, the worker's SDK
  suite, and the four end-to-end tests that exercise the sandbox itself — a tool call, a global
  mount, a guard, a heal — without `-short`, with `ACORNFALL_LIVE_SANDBOX=1` and
  `ACORNFALL_SANDBOX_INTEGRATION=1`, one sandbox per core (`SANDBOX_PARALLEL`, 6 here: 125s at
  2, 85s at 4, 72s at 6, 76s at 8), sharing the image cache under
  `/tmp/acornfall-e2e-sandboxes`. `-race` stays on: the sandbox's start, attach, and mount path
  is only taken here, and the instrumented tier is ~35s. It **fails** where there is
  no hypervisor rather than skipping: a slow tier that silently does nothing is how the bug
  class it exists for survives.
- **A test declares its engine.** `maybeSandbox` (the microVM boundary, `make test-sandbox`),
  `workspaceResources` (the host engine, `make test`), and `notSandbox` (the refusal path,
  `make test`). A test calls one of them, and the sandbox tier skips the other two; the two
  fast-tier kinds are told apart by the harness, which starts a resource test's gateway with
  `--sandbox-engine host`.
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

- CI runs everything on every push: `make test` in the verify job and `make test-sandbox`,
  which boots real microVMs. GitHub's Linux runners do have `/dev/kvm`; it is mode 660
  `root:kvm`, so the job applies the udev rule that makes it 0666 first. The dispatch input
  remains for running the microVM suite on another label.
- The worker's own side of the real engine — streamed exec, killing a command, file
  operations — is now exercised directly, `worker/test/sandbox.integration.test.ts`, instead
  of only through the end-to-end suite.
- A workspace removed from the registry keeps its folder, so its sandbox name is still in the
  test's removal list. Removing what is already gone is a no-op, which is the deliberate price
  of never naming what the test does not own.
- Prepared images and snapshots are the next slow piece; they get a suite and a target in this
  same shape.

## Follow-up: the suite itself was slow too

The tier shape above is unchanged, but the fast tier was still 33s because the tests, not just
the serialization, were paying for time nobody needed. Three tests streamed scripted tokens at
2/s because the harness could only observe "running" through the cached state, which a
3-second poll keeps current — so a run had to outlive a poll to be visible at all. Looking at
run state through the refreshed listing made that artificial slowness unnecessary, and the
keepalive test was watching a 3-second ticker for five seconds. The end-to-end package is
**5.5-8s** now (twelve consecutive `-parallel 6` runs green), ~12s under `-race`; `make test`
spends the rest on `make lint` (tsc 5.6s + eslint 7.2s, run one after the other). The decision
in this ADR is what stays: a slow piece gets its own suite and its own target.

One of the sandbox tests, `TestTheTrustFlagIsGone`, turned out to touch no sandbox at all — it
asserts the API refuses a `trusted` field — and moved to the fast tier. The remaining 17 then
turned out to be two different things, and one tier made the engine pay for the resources:
**four exercise the sandbox's execution and file surface** (a tool call runs and its output is
recorded, a global skill's script runs inside the read-only mount, a guard refuses a call, and
a broken workspace file is reported and heals), and **thirteen are feature tests whose files
live in the workspace** — the overlay, commands, skills, and delegation defaults — where the
sandbox is the environment, not the subject. Those thirteen were briefly a `make test-workspace`
tier of their own, still paying a hypervisor for file reads; the host engine
([ADR 0015](0015-host-engine.md)) removed the reason for the tier, and they now run in
`make test` on every machine, CI included. `make test-sandbox` is the four boundary tests plus
the live driver and the SDK suite, and the engine implementation is covered most directly by
those, which are seconds.
