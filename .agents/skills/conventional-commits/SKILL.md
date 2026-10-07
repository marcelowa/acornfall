---
name: conventional-commits
description: Write and check commit messages in Conventional Commits form for this repository. Use when committing, amending, squashing, or reviewing a commit message, when asked to fix history, and before pushing a branch.
---

# Commits

Every commit message here follows [Conventional Commits 1.0.0](https://www.conventionalcommits.org/en/v1.0.0/).
`scripts/check-commits.mjs` enforces the subject line, and CI runs it over a pull request's
commits — so a message that does not parse blocks the merge, not the review.

## The form

```text
<type>(<scope>)!: <description>

<body: why, wrapped at 72 columns>

<footers>
```

- **type** — one of the types below. There is no "misc".
- **scope** — optional; omit it when the change spans layers.
- **`!`** — a breaking change, and a `BREAKING CHANGE:` footer saying what callers must do.

## Which type means what here

| Type | In this repository |
|---|---|
| `feat` | The platform does something it did not before. A new endpoint, a new resolution layer, a new interface affordance. |
| `fix` | Something was wrong and is right: a hang, a leak, a wrong frame, a lost transcript, a crash. |
| `refactor` | Same behaviour, different shape. An extraction, a rename, a simpler representation. |
| `perf` | Measurable speed or memory, and the number goes in the body. |
| `test` | Tests, fixtures, harnesses — including fixing what a new test found. |
| `docs` | `docs/`, `README.md`, prompt templates, skills, comments that are documentation. |
| `build` | Makefile, `go.mod`, `bun.lock`, dependencies, tooling that runs locally. |
| `ci` | `.github/workflows/`. |
| `chore` | Housekeeping that fits nothing above: removing files, sweeping leftovers. |
| `revert` | Undoing a commit, with its hash in the body. |
| `style` | Formatting only. Rare here: `gofmt` and oxfmt do this, not people. |

Scopes in use: `control`, `httpapi`, `workerpool`, `worker`, `web`, `e2e`, `docs`, `ci`, `deps`.
A policy or a protocol that both layers share is `feat` with no scope.

## Rules

1. **Imperative, lower case, no full stop.** `fix(control): stop the sweep holding the
   registry lock` — not `Fixed`, not `Fixes`, not `Fixes:`, not a trailing `.`
2. **At most 72 characters in the subject**, and it says what changed, not what was intended.
3. **A blank line, then the body says why.** This repository's commits explain the failure
   they prevent and the alternative they rejected; keep that. The subject is what changed,
   the body is why it was needed.
4. **One concern per commit.** Two unrelated fixes are two commits, even when they were found
   together. If they were committed together by accident, split them before pushing.
5. **Breaking changes** carry `!` — `feat!: workspaces get their own routes` — *and* a footer:
   `BREAKING CHANGE: /api/conversations/... moved under /api/workspaces/<ws>/...`. The spec
   accepts either; use both, because `!` is what someone skimming the log sees and the footer
   is what someone upgrading needs.
6. **No attribution trailers** — no "Generated with", no agent or tool names — unless asked.
7. **Do not stack "fix the last commit" commits.** Amend, or `git rebase -i` and squash, and
   only on history nobody has pulled.

## Checking, and fixing

```bash
node scripts/check-commits.mjs                 # origin/main..HEAD, or the last commit
node scripts/check-commits.mjs HEAD~5..HEAD    # an explicit range
git log origin/main..HEAD --format='%h %s'     # what a push would send
```

A message already pushed, on a branch nobody else has: `git rebase -i` the range, `reword`
each one, and push with `--force-with-lease`. On a shared branch, do not rewrite: add a
commit, and say in its body what the earlier one should have said.
