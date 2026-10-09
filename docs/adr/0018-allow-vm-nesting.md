# ADR 0018 — Allow VM nesting: an allowance, granted by the engine and the machine

Status: accepted, built — inert until the engine release that offers `--nested-virt`
Date: 2026-10-09

## Context

A sandbox cannot hand its guest the virtualization CPU flag by itself. The engine has to ask
its hypervisor for nesting — the flag's presence in the guest is what a nested `/dev/kvm`
needs — and the machine has to be able to grant it: a Linux host with VT-x or AMD-V and
`nested` enabled on its KVM module, or an Apple Silicon M3 or later on macOS 15+.

The engine acornfall pins, microsandbox 0.7.7, cannot even ask. Its krun crate (0.1.40) masks
the flag unless the embedder requests it, the runtime never requests it, and its CLI has no
switch. Its predecessor had no mask at all — 0.7.6 guests nested by accident, which is the
regression upstream recorded as
[#1778](https://github.com/superradcompany/microsandbox/issues/1778). The upstream fix is
[microsandbox#823](https://github.com/superradcompany/microsandbox/pull/823): `msb create
--nested-virt`, off by default, "startup fails if the host cannot honor an enabled setting".
It is blocked on [libkrun#155](https://github.com/superradcompany/libkrun/pull/155) and
[libkrunfw#32](https://github.com/superradcompany/libkrunfw/pull/32), and no release carries
it — v0.7.8, the latest, still has no flag.

This surfaced from use, not from theory: acornfall is developed inside an acornfall workspace,
and its own sandbox tier (`make test-sandbox`) needs `/dev/kvm` inside that workspace's guest.

## Decision

`--allow-vm-nesting`, default true, and a per-workspace `allow_vm_nesting` that overrides it.
"Allow" is the decision, and it is an allowance in three ways:

- **Asked only where it can be granted.** The engine is told `--nested-virt` when it offers
  the flag and the machine can nest; otherwise the sandbox boots without it. A default must
  not cost anybody their workspace, and the hosts that cannot nest are common: M1/M2 Macs,
  cloud VMs, CI runners, machines with the host kernel's `nested` off.
- **Refused explicitly.** A workspace that turns nesting off is told to the engine anyway,
  `--nested-virt=false`, the way `network: none` is written out so an engine default cannot
  overrule a workspace.
- **Silent only when it must be.** What is decided is said: `doctor` prints availability and
  the reason it is not, and the workspace state carries whether the next sandbox will nest
  (`nested`) or why it will not (`nestedReason`). A workspace that wanted nesting and did not
  get it is a sentence, not a surprise.

Nesting is decided when a sandbox is created; changing the setting applies to the next
sandbox, exactly like the image, because the running sandbox is where dependencies live.

## Alternatives

**On as a requirement.** Rejected: upstream's semantics for an enabled setting is that startup
fails when the host cannot honor it. Requiring it by default would mean every sandbox creation
failing on every host that cannot nest — for workspaces that never wanted a VM inside a VM.

**Off by default.** Rejected as the default, though both the flag and the field exist. The
projects that want nesting are the ones this product is for — developing acornfall itself,
emulators, container-in-sandbox work — a wrong guess is cheap by construction (the sandbox
boots, the surfaces say why not), and the machine-level answer is one word to change. The
engine's own default is off because it cannot know the host; acornfall can look.

**Deeper checks than we do.** Deferred: the host checks are deliberately conservative (a
kernel parameter, a chip generation) and answer "no" when they are unsure, which is the safe
direction. The engine's own check remains the authority once the flag is passed.

## Consequences

- The feature is inert until the pinned engine release carries `--nested-virt`; on today's
  engine every workspace reports `nested: false` with the engine as the reason. Moving the pin
  is what turns it on, and the commit that moves it should say so.
- `acornfall doctor` grows a nesting line, text and JSON; the state frame grows two fields.
- The two flags differ on purpose: acornfall's `--allow-vm-nesting` says what it grants, the
  engine's `--nested-virt` says what it does with a sandbox.
- Tests: the machines' answers (Linux KVM parameters, Apple chip and OS version) are pure
  functions, tested on every platform; the create path — the flag, the explicit false, or
  nothing — is pinned against a fake engine.
