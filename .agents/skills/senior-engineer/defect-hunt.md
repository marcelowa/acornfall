# Defect hunt

The checklist behind the `senior-engineer` skill. Read the section for the subsystem you are in;
read all of it before a release gate.

A probe is a question with an observation. A finding is a claim with evidence. A suspicion is not
a finding until you can say what you ran and what you saw.

## Correctness and data

| Probe | Finding if |
|---|---|
| Every read after a write sees the write | a cache, a copy, or a stale frame answers instead |
| Every write is committed before it is reported | a success message precedes the durable write |
| Two writers to one file cannot interleave | there is no lock, or the lock is not the same file |
| A crash between two writes leaves a readable state | a half-written file is parsed as whole |
| A parse failure names the file and the field | it returns "invalid input" or a zero value |
| A missing file is different from an empty file | both take the same branch |
| A default is applied once, at the right layer | two layers apply different defaults |
| A deletion removes the record and the artefact | one is left behind and is read later |
| An id is unique across restarts | it is derived from a counter that resets |
| Time is used for order, not for truth | staleness is decided by age alone |

Repo examples: the registry written under the machinery folder instead of `state/`; a lock declared
stale by age; a `.gitkeep` missing from the tree so a fresh clone could not build.

## Lifecycle, concurrency, and recovery

| Probe | Finding if |
|---|---|
| One owner starts and stops the process | two supervisors can start it |
| A duplicated "it died" signal is idempotent | the second signal starts a second process |
| Every goroutine has an owner and a cancel | a request context owns a long-lived worker |
| Locks are taken in one documented order | two orders exist for one pair |
| No lock is held across I/O or a process call | a slow call blocks the sweep |
| Every lock has a release on every exit path | `log.Fatal`, `os.Exit`, or a panic skips the defer |
| A restart converges to the same state | a manual repair is needed after a crash |
| A stop waits for the effect, not a fixed sleep | the code sleeps and hopes |
| A dead process is observed, not assumed | `kill -0` or `wait` is missing |
| A supervisor backs off and has a cap | a crash loop spins or never retries |
| A conversation, run, or stream survives a reconnect | the client must reload to recover |

Repo examples: the lock leaked by `log.Fatalf`; a dead worker whose supervisor did not stop; a
stream state that did not clear a failed first fetch.

## Install, upgrade, uninstall

| Probe | Finding if |
|---|---|
| Fresh install from the published script | the documented one-liner is not the code in the repo |
| Install twice (repair) | the second run fails, duplicates a unit, or changes the version |
| Upgrade from the previous release | the host or machine stays on the old version |
| Upgrade when readiness fails | the host moves anyway, or the old version is gone |
| Crash mid-upgrade | the next start does not converge |
| Uninstall | it deletes the workspaces, or leaves the unit |
| Purge | it leaves a file, a unit, a user, or a disk |
| Downgrade / rollback | the older binary cannot read the newer state |
| A removed machine is not an upgrade | install removes the disk and remakes it from the old release |
| The artefact names its release | an image or a disk can be mistaken for another release |
| A version is compared as a version | strings decide "newest", or a pre-release is hidden |

Repo examples: `v0.9.38` chosen as newest; an install that removed the machine; an image that did
not name its release; `PATH` without `/usr/sbin` so `iptables` was missing.

## Contracts and compatibility

| Probe | Finding if |
|---|---|
| Go and TypeScript protocol shapes are generated or compared | they are mirrored by convention only |
| A new union member breaks every switch | a default arm swallows it |
| The CLI and the API agree on a field name | one says `workerUp`, the other says `lifecycle` |
| The UI reads one fact for one question | two screens compute "ready" differently |
| A persisted format has a version or a migration | an older file is read as the new shape |
| The engine version is pinned once | Go and worker can ship different engines |
| A catalog written by a newer engine is readable by an older one | migration is one-way and unchecked |
| A removed field is removed from both sides in one commit | one side still sends it |

Repo examples: `worker/src/protocol.ts` mirrors `gateway/internal/protocol`; `capabilities.sandbox`
reported the store's name instead of the driver's; the engine/catalog version conflict.

## Errors and truth

| Probe | Finding if |
|---|---|
| Every error names the cause and the place | it repeats the symptom |
| An error is logged once or returned once | both happen |
| A check asks the system | it trusts a flag, a cache, or a previous result |
| A success message follows the effect | it precedes the effect |
| A failure leaves the old thing working | it removes the old thing first |
| A "not found" is not a "not permitted" | `EPERM` is reported as missing |
| A container state is not a sandbox verdict | `RUNNING` is treated as "tools work" |
| The console says the same thing as the API | the UI invents a friendlier, false sentence |

Repo examples: "this workspace has no sandbox" for three different causes; `ok` from
`systemctl enable --now` for a dead unit; `lxc-start` "ABORTING" for an already-running container.

## Security and defaults

| Probe | Finding if |
|---|---|
| The listener's exposure is stated where it is chosen | remote is the default with no warning |
| A token is either required or clearly absent | the docs promise one that is not checked |
| A secret never enters a log, a fixture, or a transcript | it is in a story, a test, or a commit |
| A file the user edits is validated at the boundary | a typo takes the process down |
| A tool's arguments are checked at the boundary | they are trusted as typed |
| A path from the user cannot escape the workspace | `..` or an absolute path is joined unchecked |
| A default is the safe one | the convenient one is chosen silently |
| A permission is the minimum | a container or a unit runs wider than it needs |

Repo examples: the PAT pasted into a transcript and found in a story fixture; the token removal
that left two docs still promising a token.

## Interface truth

| Probe | Finding if |
|---|---|
| A disabled action says why | it is disabled with no reason, or enabled and fails |
| A phase is read from one field | each screen recomputes readiness |
| A stale run keeps its dot and loses the accent | a finished run still looks live |
| A failed first fetch is cleared by a retry | the error sticks after success |
| A long turn keeps its place | the transcript jumps on a new frame |
| A setting is read back after it is written | the UI shows the value it hoped for |
| An empty state is different from a loading state | "no conversations" shows while loading |
| A phone width keeps every control reachable | the composer or the stop control is clipped |

Repo examples: "Starting api key…" before anything was pasted; a workspace offering "New
conversation" before the harness was ready (ADR 0032).

## Tests and gates

| Probe | Finding if |
|---|---|
| The test fails without the fix | it passes before and after |
| The test exercises the subject | it skips when the engine is missing, and the suite is green |
| The test is at the lowest tier that can decide it | a unit bug needs a full machine |
| The test waits for a condition, not a duration | `time.Sleep` is the synchronisation |
| The test cleans up what it creates | a temp dir or a container is left behind |
| The e2e cleanup removes only its own resources | it removes every test's |
| The race detector runs over the real process | only the unit binary is instrumented |
| A skipped test is visible | a skip is reported as a pass |
| A feature in `docs/features.md` names a real test | the test was renamed or deleted |
| A gate runs on every change | it exists but CI never calls it |

Repo examples: `make test` green while `prove` booted nothing; 384 temp dirs before anyone looked;
the e2e cleanup that removed every sandbox labelled `acornfall`.

## Docs and decisions

| Probe | Finding if |
|---|---|
| The ADR status matches the code | it says "draft" while the code follows it |
| The README's install line matches the default branch | it fetches a script that does not know the feature |
| A flag's help matches its behavior | it promises a token that is not there |
| A doc names the current paths | it names `~/.acornfall` after the layout moved |
| A feature list names the test | the test name is stale |
| A decision has its alternatives | only the chosen option is written |
| A breaking change is marked | callers are not told what to do |
| A doc's example runs | it uses a removed flag or an old version |

Repo examples: ADR 0021/0022 still "draft"; `install.sh --help` and `docs/installing.md:50` still
promising a token; the README fetching `main`'s old script.

## Performance and resources

| Probe | Finding if |
|---|---|
| Memory is bounded per conversation and per stream | a long transcript grows without a limit |
| A queue has a bound | one slow consumer grows it forever |
| A file handle, container, or process is released on every path | a failure path leaks it |
| A retry has a deadline and a cap | it retries forever or not at all |
| A poll has a backoff | it spins at full speed |
| A large output is streamed, not buffered twice | it is copied per frame |
| A release does not store the same artefact twice | 193 MiB per release is uploaded again |
| A build on `/` is avoided | the sandbox has 3.9 GB |

Repo examples: the release round-tripping an artefact through artifact storage; the sandbox disk
growing per machine before the artifact/disk split.

## Observability

| Probe | Finding if |
|---|---|
| The log names the process, the workspace, and the release | it says "error" with no id |
| A failure the user sees is in the log | the console says it, the log does not |
| A failure the log sees is in the state | the owner must read a log to know |
| A version is in the startup line | you cannot tell which release answers |
| A slow step has a duration | you cannot tell where the time went |
| A retry or a replacement is logged | the old image is swapped silently |

Repo examples: the sign-in stall that nobody captured; the appliance replacement that was logged
only after it was added.

## The last pass

Before you call a release ready:

1. Run the 0.10 release gate in `SKILL.md` on a disposable target, from the artefact a user
   downloads.
2. Read the ledger top to bottom. Every S0 and S1 is closed or explicitly accepted. Every S2 is
   closed, scheduled, or accepted with a reason.
3. Read `HANDOVER.md`, `notes.txt`, and `docs/features.md` against the code. No stale claim.
4. Run the gates twice. The second run is the one that catches a non-idempotent install.
5. Ask the owner one question: "What would make you say 0.10 is still not perfect?" The answer is
   a new probe, not a disagreement.
