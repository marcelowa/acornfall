# ADR 0015 — The host engine: an explicit, unisolated way to run the tools

Status: accepted, built
Date: 2026-10-06

## Context

The worker has no host path to a workspace: it reads `AGENTS.md`, `.agents/`, skills, commands,
and the files it runs only through its sandbox engine ([ADR 0012](0012-sandbox.md)). That is
the property the microVM buys, and it has two costs that showed up as soon as the resource
features were tested:

- A microVM costs seconds to create and boot, per workspace, so thirteen end-to-end tests that
  only *read* a workspace's resource files paid for thirteen machines.
- The resource features were gated on a hypervisor being present and working — a microVM per
  test, on this machine or in CI with its `/dev/kvm` permissions, image pulls, and boot cost.
  Thirteen tests that only *read* a workspace's resource files should not have that
  dependency to test an overlay rule.

ADR 0012 left the question open on purpose: "Running unconfined must be a decision somebody
made, never a state the system drifted into. Whether there is a config knob that *grants* the
fallback is still open." This is that decision.

## Decision

**A second engine, `host`, selected explicitly, never a fallback.** `--sandbox-engine host`
(or `ACORNFALL_SANDBOX_ENGINE=host`) runs commands and file operations on the host, in the
workspace, with the user's own permissions and reach. The default stays `microsandbox`: a run
that does not name an engine gets the microVM engine and, without a hypervisor, the tools
refuse exactly as before.

The guardrails are part of the decision, not politeness:

- **Nothing selects it by itself.** A missing hypervisor, a failed install, or an unknown
  engine name never becomes the host engine. A typo is refused with the list of engines.
- **Every surface says it is not isolated.** `Driver.Isolated()` is false, the state frame
  carries `"isolated": false`, `acornfall doctor --sandbox-engine host` prints it, and the
  startup log says it in a sentence.
- **The host engine has no mounts.** Global resources are plain host paths, so there is no
  read-only enforcement: under this engine the agent can edit its own instructions. That is
  part of what "unconfined" means, and the reason it is not the default.
- **`--sandbox-state` is refused with it**, because there is no engine store to point at.

Command execution uses a detached process group so a timeout or an abort kills what the shell
started, not only the shell.

## Alternatives

**Auto-select the host engine when there is no hypervisor.** Rejected, and the reason this ADR
exists: a state the system drifted into is how a machine that used to be sandboxed becomes
unconfined after an upgrade. The refusal path stays the answer to a missing hypervisor.

**A test-only stub that never ships.** Rejected: those thirteen tests would then exercise a
configuration nobody runs, and the interesting failures — the ones that happen when the tools
actually work — would be the ones not tested. The engine they run on has to be the engine the
product offers.

**bubblewrap instead, or first.** Deferred, not rejected: bwrap (0.11 is installed here) keeps
namespace isolation without a VM boot and is the better fast engine on Linux, and the seam is
ready for it — it reuses the host engine's file operations and changes only `exec`. It is
Linux-only, so macOS still needs a host engine, and hardening a bwrap profile (what to expose
read-only, user namespaces, CI availability) is its own decision. This ADR is the decision
that lets the resource tests run everywhere; bwrap is the next engine, not a prerequisite.

**Mount the workspace read-only for a resource-only mode.** Rejected: the worker also *writes*
the workspace through this path when tools run, and a read-only mount would be a third mode
with its own rules and no isolation gain over the host engine for the tests.

## Consequences

- `make test` now runs the thirteen resource tests on the host engine. They need no hypervisor,
  take ~0.4s each instead of ~4s, and run in CI. `make test-workspace` is gone; the four tests
  that exercise the microVM's execution, mounts, and read-only behaviour stay in
  `make test-sandbox`, which also runs on every push since the hosted runners have KVM
  ([ADR 0013](0013-test-tiers.md)).
- The host engine is covered by its own suite in the fast tier (`worker/test/host.test.ts` for
  exec, kill, and file operations; `gateway/internal/sandbox/host_test.go` for the driver and
  the engine selection), and one resource test asserts the state reports it as unisolated.
- A user on a machine without a hypervisor now has a supported way to run the agent's tools
  anyway — by asking for it, in the full knowledge of what it means.
