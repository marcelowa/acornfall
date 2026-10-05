# Engineering standards

The rules this project holds itself to, why each one exists, and what fails when you break it.
Read it before changing something; add to it when a rule earns its place.

It replaces the two standards documents that came before it — prompt-shaped, asking for a
generic layout and a big-bang reorganisation of a working codebase. They are in the history
rather than in the tree; the rules worth keeping are here, corrected where they were wrong and
with the reasoning the originals did not carry. This asks for the smallest change that
satisfies a rule, in the shape the project already has.

A rule's number is an identifier, not an order: rules are added, never renumbered, because
other documents cite them (the Makefile cites G3).

Two words are used precisely:

- **Enforced** — a command fails. The check is named, and it runs in `make lint` or `make test`.
- **Convention** — no check; it is held by review, and saying it is convention is honest about
  that rather than pretending otherwise.

## Working with an agent

Most changes here are made with one, so the rules assume it. Three instructions to give it, and
to follow yourself:

1. **Do not scaffold, and do not reorganise.** The layout below is deliberate; `mkdir`ing a
   generic tree or moving files into `domains/` and `infra/` is a change with no feature behind
   it, and it is the change most likely to break something.
2. **Make the smallest change that satisfies the rule.** If a rule and the existing code
   disagree, say which one should move before touching either.
3. **Run `make lint` and `make test` before saying it is done.** A change that has not run the
   tests has not been made.
4. **When the work is finished, run `/deslop`** (`.pi/prompts/deslop.md`). It is the review pass
   that removes what accumulated: abstractions nothing needed, defensive branches inside trusted
   code, comments that restate the code. It preserves behaviour, asks before removing anything
   significant, and validates with the commands above. Run it per work package, not as a
   periodic sweep of the repository — a large cleanup diff is a change nobody can review.

## The shape of the repository

```
gateway/cmd/acornfall/     one binary, flags, wiring, logging, signals. Nothing else.
gateway/internal/control/  the domain: workspaces, conversations, defaults, resolution
gateway/internal/httpapi/  the transport edge: routes, auth, streaming
gateway/internal/protocol/ the wire types, mirrored by the worker
gateway/internal/workerpool/ one harness process: spawn, supervise, JSONL
gateway/web/               the client, embedded; no build step
worker/src/                the harness adapter, one file per concept
worker/test/               unit tests, and the protocol contract
docs/adr/                  decisions, numbered, with the alternatives
docs/features.md           what it does, with the test that covers it
```

`internal/` is the default for Go. Nothing is exported for its own sake. The worker's files are
named after the concepts in the ADRs (`config.ts`, `hooks.ts`, `commands.ts`, `delegation.ts`,
`skills.ts`, `meta.ts`) because that is what makes them findable; a `domains/` and `infra/`
split would hide exactly that.

## Rules for everything

| # | Rule | Why | Check |
|---|---|---|---|
| S1 | A comment explains **why**, and names the failure it prevents. | The next reader has the same information as you: the bug, not the style. | Convention |
| S2 | No behaviour change without a test that **fails without it**. Reintroduce the bug and watch it fail. | A test that passes before and after proves nothing. | Convention, `make test` |
| S3 | A feature is listed in `docs/features.md` with the test that covers it. | The inventory is how anyone knows what "done" means. | Convention |
| S4 | A decision that is not obvious gets an ADR: context, alternatives, what was chosen. | Six months later the question is "why not the obvious thing". | Convention |
| S5 | Errors are loud at startup, returned at boundaries, and told to the model as results. | A silent misconfiguration is a support burden; a stack trace in a tool result is noise. | Convention, end-to-end |
| S6 | The protocol is defined once per language; change both in one commit. | `worker/src/protocol.ts` ↔ `gateway/internal/protocol/protocol.go` are one contract. | Convention |
| S7 | Storage is the truth, frames are complete views, a reconnect is safe. | The client must be able to throw its state away. | `TestTheStreamSendsStateViewsAndKeepalives` |
| S8 | One path for one thing: if a second entry point needs what the first does, extract it. | Recovery reimplemented start and got it wrong (a duplicate conversation, no model). | Convention |
| S9 | A lint exception carries its reason on the same line. | An unexplained `nolint`/`disable` is a rule losing quietly. | `make lint` |

## Go

### Layout and design

| # | Rule | Why | Check |
|---|---|---|---|
| G1 | `ctx` is the first argument, and the **lifetime** belongs to the owner. A request context never owns a goroutine. | A supervisor started with a request's context stops supervising when that request ends. | Convention |
| G2 | Interfaces are declared where they are consumed; constructors return concrete types. If there is one implementation and no test double, do not write the interface. | An interface invented for its own sake costs indirection and buys nothing. | Convention |
| G3 | Dependencies are passed explicitly. No package-level mutable state, and `init()` is not for setup. | Import order must not decide program behaviour. | `make lint` |
| G4 | Document the lock order on the struct, and take locks in that order. **Never hold a lock across I/O or a process call.** | Two orders for one pair of locks is a deadlock that only shows under a writer. | `internal/control/lockorder_test.go` |
| G5 | One owner per goroutine, and the owner cancels it. A supervisor must be idempotent: a duplicated "it died" signal must not start a second process. | A closed worker that restarted itself left two harnesses over one storage. | Convention, `TestABrokenWorkspaceFileIsReportedAndHeals` |
| G6 | `panic` is for the unrecoverable; `log.Fatal` and `os.Exit` live in `cmd/` only. | A library that exits takes the decision away from its caller. | Convention |
| G7 | `internal/` is the default; an exported identifier has a doc comment and a caller. | The public surface is a cost, not a status symbol. | Convention |
| G14 | Ending the process is the entry point's decision: a signal or an explicit shutdown, cleanup once, in `cmd/`. A package returns an error and lets its caller decide. | A library that exits takes the decision away, and cleanup in five places means it happens in none of them reliably. | Convention |

### Errors

| # | Rule | Why | Check |
|---|---|---|---|
| G8 | Wrap with `%w` where a caller can act on the cause; return as-is where wrapping adds nothing. | `errors.Is` works only if someone wrapped. | Convention |
| G9 | Never log an error **and** return it. | One failure, one report; double reporting trains people to ignore logs. | Convention |
| G10 | An ignored error is written as `_ =` and only where the reason is obvious: a `Close` on a read, a best-effort shutdown, a response whose failure the client already sees. Never for a write to storage, a commit, or a request. | `errcheck` bans the whole class and gets ignored; this bans the part that matters. | `staticcheck` |

### Tests

| # | Rule | Why | Check |
|---|---|---|---|
| G11 | A unit test lives in the package it tests and needs no process. A test that needs processes, ports, or a harness lives in `internal/e2e` and skips under `-short`. | The fast loop has to stay fast, or nobody runs it. | `make check` vs `make test` |
| G12 | Wait for a condition with a deadline, never for a fixed duration. | `time.Sleep(2 * time.Second)` is either slow or flaky, and often both. | Convention, review |
| G13 | `-race` is part of the suite, not a special occasion — including for the gateway the end-to-end tests spawn, which is a separate process and would otherwise be uninstrumented. | The bugs this project has had were concurrency bugs. | `make test` |
| G15 | A table when the test is the same check over different inputs, so the cases read as a list of situations rather than as prose. | `resolveThinking` and the defaults chain are only legible as a table; a name per case says what each one is for. | Convention, review |
| G16 | A test removes what it creates. A temp directory is scratch, not a record. | 384 had accumulated in `/tmp` before anyone looked, and the end-to-end harness left a built binary behind on every run — a `defer` before `os.Exit` never runs. | Convention, review |

## TypeScript / Bun

### Types at the edges

| # | Rule | Why | Check |
|---|---|---|---|
| T1 | `any` is banned; use `unknown` and check. | An `any` is a decision to stop knowing. | `@typescript-eslint/no-explicit-any` |
| T2 | `as` is allowed only where a check immediately precedes it, or at a documented trust boundary. | The cast is the boundary; write down which side of it you are on. | `make lint` |
| T11 | The runtime's own tools and APIs first — `Bun.file`, `bun test`, `bun --watch`, `Bun.spawn`. A dependency needs a reason, which is why there is no validator library here: the payloads we parse are our own protocol (checked by shape) and files the user writes (checked field by field, with tests). | Every dependency is someone else's release schedule, and a validator earns its place against an untrusted, changing payload, not a pipe we control. | Convention, review |
| T3 | A union that grows must break every `switch` over it: `Exclude` the parts handled elsewhere, and make the default `never`. | A new protocol command silently became "unsupported" instead of a compile error. | `switch-exhaustiveness-check` |
| T4 | Strict compilation, including `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`, and `verbatimModuleSyntax`. | `strict` alone still lets `array[0]` be a value that is not there. | `bun run typecheck` |

### Behaviour

| # | Rule | Why | Check |
|---|---|---|---|
| T5 | No floating promises: `await`, `return`, `.catch`, or an explicit `void` for something deliberately not awaited. | A rejected promise nobody holds is an invisible failure. | `no-floating-promises` |
| T6 | Side effects belong to the entry point. `config.ts`, `hooks.ts`, `commands.ts` are functions of their arguments. | It is why unit tests can cover the rules without a harness. | Convention |
| T7 | A misconfiguration is loud where it is read, naming the file and the field. | A guard without a reason must not become a guard that does nothing. | `worker/test/config.test.ts` |
| T8 | An error the model should see is a tool result, not a throw. An unexpected exception inside a command is an error response, not a process exit: the worker holds live runs, and staying up is the service it provides. | Throwing away a tool's explanation loses the only useful part, and a crash takes every conversation with it. | Convention |
| T9 | A store never hands out its own object; a task commits before it shows. | Mutation through a getter is the hardest bug to find. | `worker/test/skills.test.ts` |
| T10 | Serialise where order is the contract (`CommandQueue`), and say so where you do it. | Answers that overtake their questions is a race with a plausible-looking log. | `worker/test/protocol.test.ts` |

## Enforcement

`make lint` is the static half. It runs only what it finds installed, and says what is missing
rather than pretending to have checked:

| What | Command |
|---|---|
| Go formatting | `gofmt -l` |
| Go correctness | `go vet ./...` |
| Go beyond vet | `staticcheck ./...` (2025.1+ for Go 1.24) |
| no `init()` in the gateway | a grep, because the rule is absolute |
| TypeScript types | `bun run typecheck` |
| TypeScript rules | `bun run lint` (eslint + typescript-eslint, type-aware) |
| lint exceptions have reasons | a grep |

`make check` is the fast loop (types and unit tests, ~6s). `make test` is everything: unit
tests, the worker protocol against a real worker process, `-race`, and the end-to-end suite
against a real gateway (~60s). `make tools` installs the linters.

None of this is enforced by a machine unless it runs on every change: `.github/workflows/ci.yml`
runs `make lint` and `make test` on push.

## The evidence

Every rule above with a bug behind it is here, because a rule with a story survives contact
with a deadline:

| The bug | The rule it produced |
|---|---|
| The gateway hung: the eviction sweep took the registry lock and then a control's, while a state build took them in the opposite order. | G4 |
| A workspace whose trust changed ran **two harnesses over one storage**: closing a worker did not stop its supervisor, and a death was announced twice. | G5 |
| A typo in a workspace's guard config took the whole gateway down, and the reason was only in the log. | S5, T7 |
| Recovery created a second conversation, landed on it, and skipped the settings a first start reads — so a workspace whose first start failed answered nothing. | S8 |
| A workspace that had never saved settings never read the install defaults. | S2 (the test that caught it) |
| `auth_answer` was handled before the command queue on purpose (queueing it would deadlock), so the switch looked incomplete. | T3 — the fix was to say it in the type, not to reorder the code. |

## Convention (not enforced)

Named here so nobody mistakes them for guarantees: naming, comment quality, commit-message
shape, which decisions deserve an ADR, keeping `docs/features.md` current, and the judgement
that a rule does not apply to a particular case. If a convention keeps getting broken, give it
a check and move it into a table above.
