---
description: Simplify the work just completed, without changing behaviour
argument-hint: "[commit, range, or files]"
---
Review the work just completed — ${@:-the changes in the most recent commit, or the current branch's commits if there is more than one} — and simplify its implementation without changing its intended behavior.

`docs/engineering/standards.md` is what this repository is held to. Read it first: where this prompt and that document disagree, the document wins.

## Scope

- Focus on code added or affected by that work and the nearby code needed to simplify it coherently.
- Do not perform unrelated cleanup, and do not reorganize the layout: it is deliberate, and moving files is a change with no feature behind it.
- Read the affected files in full and understand the relevant invariants, call sites, tests, and public API before editing. Decisions and their reasons are in `docs/adr/`; what the platform does, with the test that covers each part, is in `docs/features.md`.

## What to remove or simplify

- Remove abstractions that have no clear responsibility or do not reduce real complexity.
- Inline trivial helpers, wrappers, adapters, and pass-through layers when they obscure rather than clarify behavior.
- Remove duplicated logic and put shared behavior at the appropriate existing layer.
- Remove speculative flexibility, configuration, extension points, and generic machinery that have no current requirement.
- Remove speculative defensive programming inside trusted code. Validate at real trust boundaries; rely on types and established invariants internally.

  The trust boundaries here are specific: files the user edits (`AGENTS.md`, `.agents/config.json` and `.acornfall/config.json`, agent frontmatter, `settings.json`), the model's tool arguments, the worker protocol (`worker/src/protocol.ts` ↔ `gateway/internal/protocol/protocol.go`), and the HTTP API. Validation at those is a feature, not defensiveness. Inside the process, rely on the types and on what the tests pin.

- Do not keep fallback behavior for states that should be impossible. Prefer fixing the invariant or type model.
- Simplify excessive state, boolean flags, branching, indirection, and special cases. Rework the underlying representation when that is clearer.
- Tighten TypeScript types so invalid states are unrepresentable. Avoid `any`, unnecessary assertions, broad types, and optional fields for impossible states.
- Prefer direct, readable code over cleverness, premature abstraction, and framework-like infrastructure.
- Delete comments that merely restate the code, but preserve comments that explain constraints, intent, or non-obvious decisions.

  Comments in this repository are load-bearing: most name the failure a line prevents or the reason a choice was made, often with the bug that motivated it. A comment that names a failure or a decision is never slop. Only one that restates the code is.

## Approval gate for significant removals

Before making any significant or potentially intentional removal, stop and ask the user for approval. First explain:

1. what you propose to remove or change;
2. why it appears unnecessary or overly defensive;
3. what behavior, compatibility, extensibility, validation, or failure handling could be affected;
4. the simpler replacement, if any; and
5. your recommendation.

Wait for explicit approval before applying that change. Do not bundle approval for multiple independent decisions; present them separately when the tradeoffs differ.

Treat a decision as significant when it removes or materially changes any of the following:

- user-visible behavior or supported workflows, including anything listed in `docs/features.md`;
- public APIs, persisted formats, protocol behavior, or backward compatibility;
- validation, authorization, security checks, recovery, retries, fallbacks, or error handling;
- an abstraction or extension point that appears deliberate or has multiple consumers;
- functionality covered by tests or documentation;
- code whose purpose or invariant is uncertain.

Routine, behavior-preserving cleanup does not require approval, such as inlining a single-use trivial helper, removing an unreachable branch proven impossible by the type model, or deleting newly added duplication. If uncertain whether a removal is significant, ask.

## Constraints

- Preserve intended behavior unless the user explicitly approves a change.
- Do not remove code merely because it is unused until you have checked whether it is a public API, extension point, generated entry point, or intentionally retained compatibility surface.
- Do not replace clear code with a new abstraction solely to reduce line count.
- Do not weaken tests to permit simplification. Update tests only when an approved behavior change or a cleaner equivalent structure requires it.
- A simplification that removes a capability is a feature change: it goes through the approval gate, and `docs/features.md` changes with it.
- Validate with `make lint` and `make test`. `make check` is the fast half and is not enough on its own; `make test` adds the worker protocol and the end-to-end features under `-race`. When `gateway/web/` changed, `make ui` needs a running gateway.

## Completion

After editing, review the final diff for avoidable complexity, duplication, indirection, defensive branches, and accidental behavior changes. Report:

- what was simplified;
- which invariants the implementation now relies on;
- any significant removals you did not make because approval was not granted; and
- the validation performed and its results.

Passing tests and type checks is necessary but not sufficient. Leave the affected code easier to understand and change.
