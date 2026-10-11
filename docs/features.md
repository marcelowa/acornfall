# Features

What the platform does, stated as things that are observable from outside, and where each is
tested. It is the list to read before changing something: a feature here has a test that fails
when it stops working, and the test names are the map.

Each feature is covered at the lowest level that can decide it:

| Level | Command | What it can decide |
|---|---|---|
| Unit (Go) | `go test ./...` | Resolution, registries, lock order, arities. Milliseconds, no processes. |
| Unit (worker) | `bun test` (from `worker/`) | The overlay, guards, commands, skills, credentials, the worker protocol. Under a second. |
| Feature (end to end) | `go test ./internal/e2e/...` | A real gateway, a real worker, and a scripted provider over HTTP: everything a client can see. Resource tests run on the host engine; tests that need no engine run against the refusal path. |
| Sandbox engine boundary | `make test-sandbox` | The live driver, the worker SDK (exec streaming, kill, file operations), and the four end-to-end tests that exercise execution and the mounts. Needs a hypervisor (~35s). |
| Interface | `make ui` | The served interface, driven in a real browser: the rail, the transcript, the splitter, per-pane controls, the theme, and the phone drawer. |

`make test` is the default gate: `-short -race`, the worker units, the Go units, and the
feature suite — resource tests on the host engine, tests that need no engine against the
refusal path — so the same command behaves the same on every machine, including CI
([ADR 0013](adr/0013-test-tiers.md)). It needs `bun` and `make deps`; without them the
end-to-end suite skips with a reason rather than failing. `make test-sandbox` is the hypervisor
tier — the microVM engine boundary — and fails rather than skips where there is no hypervisor.

## The scripted provider

Nothing here calls a model. `ACORNFALL_DEV_SCRIPT` points the worker at a JSON file of rules:
the first rule whose `match` is a substring of the last user message wins, its `tools` are
called, and its `reply` is the answer. That is what makes a feature driven by a tool call — a
guard blocking one, a subagent being spawned — testable offline and deterministically.

```
{"rules": [
  {"match": "delete the build", "tools": [{"name": "bash", "args": {"command": "rm -rf build"}}], "reply": "done"}
]}
```

`ACORNFALL_DEV_PROVIDER=1` is the older, hand-driven mode: one real `bash` call per turn and a
reply quoting the request. `make dev` uses it.

## Conversations

| # | Feature | Test |
|---|---|---|
| C1 | A fresh install has a root conversation to type into, and the state names it. | `TestAFreshInstallHasARootConversation` |
| C2 | Create, list, rename, hide, restore. | `TestConversationLifecycle` |
| C3 | A conversation is named after its first user message until it is named. | `TestConversationTitleComesFromTheFirstMessage` |
| C4 | Hiding is a tombstone: the transcript survives, and it can be restored. | `TestConversationLifecycle` |
| C5 | A fork branches *before* a user turn, keeps the history that led to it, and leaves the parent alone. | `TestForkBranchesBeforeATurn` |
| C6 | Conversation ids are the harness's own and are unique only within a workspace; a route always names the workspace. | `TestWorkspacesAreIsolatedAndStartOnDemand` |

## Turns and the transcript

| # | Feature | Test |
|---|---|---|
| T1 | A prompt produces a transcript: the message, the prompt that was sent, the answer, and the spend. | `TestPromptRoundTrip` |
| T2 | Tool calls run for real, and both the call and its output are recorded. | `TestAToolCallRunsAndIsRecorded` |
| T3 | Steering joins a running turn instead of starting a second one. | `TestSteeringJoinsTheRunningTurn` |
| T4 | Abort stops the run, and the conversation is usable afterwards. | `TestAbortStopsTheRun` |
| T5 | A conversation can choose its own model and thinking level. | `TestThinkingIsClampedButTheRequestIsRemembered` |
| T6 | A level the model cannot express is clamped, and what was asked for is kept and reported. | `TestThinkingIsClampedButTheRequestIsRemembered` + `gateway/internal/control/thinking_test.go` |
| T7 | Spend is reported per conversation. | `TestUsageIsReportedForAWorkspace` |
| T8 | A model with no credentials, or a definition that does not exist, is refused where it was chosen. | `TestUnusableChoicesAreRefused` |

## Defaults

The chain is **conversation → its definition → this workspace → the install → last resort**.

| # | Feature | Test |
|---|---|---|
| D1 | A workspace's defaults apply to conversations that never chose, and the state says which layer each came from. | `TestWorkspaceDefaultsApplyAndSayWhereTheyCameFrom` |
| D2 | An install default applies to every workspace, without a restart; a workspace's own default wins. | `TestInstallDefaultsApplyToEveryWorkspace` |
| D3 | An install default is one file, `~/.acornfall/settings.json`, and clearing it leaves no file. | `TestInstallDefaultsApplyToEveryWorkspace` |
| D4 | With nothing set anywhere, a preferred model runs rather than whichever is listed first, reported as the last resort. | `TestTheLastResortRunsWhenNothingIsSet` + `TestLastResortPrefersAnExplicitModel` |
| D5 | A layer that cannot be used — a model no longer offered, a definition that is gone — falls through and is *not* rewritten. | `TestDefaultsFallThroughLayers` |
| D6 | A resolved default is never persisted as this workspace's own choice. | `TestResolvedDefaultsAreNotPersistedAsThisWorkspace` |
| D7 | A workspace that has never saved settings still follows the install defaults. | `TestInstallDefaultsApplyToEveryWorkspace` |

## Workspaces

| # | Feature | Test |
|---|---|---|
| W1 | A workspace is a folder with its own harness, storage, and history; a second one is created by name and starts on demand. | `TestWorkspacesAreIsolatedAndStartOnDemand` |
| W2 | The interface creates workspaces inside one folder: a path is refused, not ignored. An existing folder of that name is adopted. | `TestWorkspaceCreationTakesANameAndRefusesAPath` |
| W3 | A workspace's own rules, guards, agents, and commands are read. The `trusted` flag that used to gate this is gone, and the API refuses it rather than ignoring it. | `TestAWorkspacesOwnResourcesAreRead`, `TestTheTrustFlagIsGone` |
| W4 | Removing forgets a workspace and stops its worker; it never deletes the folder or the history, and general cannot be removed. | `TestRemovingAWorkspaceKeepsItsFolderAndHistory` |
| W5 | A broken resource file is reported by that workspace, not fatal to the gateway, and fixing the file is enough. | `TestABrokenWorkspaceFileIsReportedAndHeals` |
| W6 | Idle workers are evicted; a watched or busy one is not. | `TestEvictionStopsOnlyIdleUnwatchedWorkspaces` |
| W7 | The tools can run on the host engine, chosen explicitly, and the state says it is not isolated. It is never selected by a missing hypervisor, and an unknown engine is refused with the list. | `TestWorkspaceRulesReachThePrompt`, `TestTheHostEngineNeedsNothing`, `TestIsolationSaysWhichEngineSeparatesFromTheHost`, `TestEngineRefusesANameItDoesNotImplement`, `worker/test/host.test.ts` |
| W8 | A tool call against a sandbox the engine stopped for being idle wakes it and runs, instead of failing or reporting files as missing. | `worker/test/microsandbox.test.ts` + `worker/test/sandbox.integration.test.ts` (real stop under a live client) |
| W9 | The worker refuses a loaded SDK that is not the pinned engine, and doctor reports a store the pinned engine cannot read — so no side migrates the shared catalog past the other. | `worker/test/microsandbox.test.ts` + `TestVerifyReadsTheStoreThroughThePinnedEngine` + house-rules pin check |

## Resources: rules, agents, skills

| # | Feature | Test |
|---|---|---|
| R1 | `AGENTS.md` reaches the prompt as its own section. | `TestWorkspaceRulesReachThePrompt` |
| R2 | Definitions overlay by layer: a workspace definition shadows a global one of the same name, and the explain view says which file won. | `TestAgentDefinitionsOverlayByLayer` |
| R3 | Instructions concatenate global-then-workspace, a definition's model and level beat both, denials union, and a denial beats an allow. | `TestConfigLayersFoldIntoOneAgent` + `worker/test/config.test.ts` |
| R4 | Unknown frontmatter keys are reported, never silently dropped. | `worker/test/config.test.ts` |
| R5 | Reload re-reads files without restarting anything. | `TestReloadPicksUpANewDefinition` |
| R6 | Skills are offered by name and description only; the body loads when the model asks, and an agent that names skills offers only those. | `TestSkillsAreOfferedAndFilteredByAgent` + `worker/test/skills.test.ts` |
| R7 | Slash commands come from two layers, the workspace shadowing the install, and the listing says which file each came from. | `TestCommandsComeFromBothLayersAndTheWorkspaceWins` |
| R8 | Expansion happens server-side, so the transcript records what the model saw; arguments are appended when there is no placeholder. | `TestCommandExpansionIsWhatTheModelSees`, `TestCommandArgumentsAreAppendedWhenThereIsNoPlaceholder` + `worker/test/commands.test.ts` |
| R9 | A message that merely starts with a slash is not rewritten. | `TestAnUnknownCommandIsSentAsWritten` |
| R10 | A resource bundle is read from `.agents/` — the ecosystem's name, where the Agent Skills convention points — as well as `.acornfall/`, at the user level (`~/.agents`) as well as in the workspace. Ours wins when a folder has both. Prompt templates are read from `commands/` or the ecosystem's `prompts/`. | `TestTheEcosystemAgentsFolderIsRead`, `worker/test/{config,commands,skills}.test.ts` |
| R11 | The global resource folders are mounted into every sandbox at their own paths, read-only, so a skill's instructions can name a script and have it run. The install folder itself — credentials, token, state — is never mounted. | `TestAGlobalSkillsScriptRunsInsideTheWorkspace`, `TestGlobalPathsAreTheResourceFoldersAndNeverTheInstall`, `TestRenderMountsTheGlobalsReadOnly` |

## Guards

| # | Feature | Test |
|---|---|---|
| G1 | A guard blocks a tool call and tells the model why; the transcript records the call and the refusal. | `TestTrustDecidesWhetherAWorkspaceIsRead`, `worker/test/hooks.test.ts` |
| G2 | Guards accumulate across layers: one added anywhere holds everywhere. | `worker/test/config.test.ts`, `TestTrustDecidesWhetherAWorkspaceIsRead` |
| G3 | A guard that cannot be understood is an error where it is written, not a rule that quietly does nothing. | `worker/test/config.test.ts`, `TestABrokenWorkspaceFileIsReportedAndHeals` |
| G4 | Path confinement survives `..`, sibling prefixes, and the workspace directory itself. | `worker/test/hooks.test.ts` |

## Delegation

| # | Feature | Test |
|---|---|---|
| H1 | `delegate` hands a task to a subagent and returns its answer as the result of the call. | `TestDelegateWaitsForTheChildAndReturnsItsAnswer` |
| H2 | A peer is a normal conversation: it is listed, records who created it, and is not owned. | `TestAPeerIsANormalConversation` |
| H3 | The overlay decides what a conversation may do, and the policy is reported so a refusal can be explained. | `TestDelegationPolicyCanForbidSpawning` |
| H4 | `child`, `peer`, `maxChildren`, `maxDepth`, `maxPeers`, `maxWakes`, `address`, `maxPeersTotal` parse and override the defaults. | `worker/test/config.test.ts` |

## Liveness and the stream

| # | Feature | Test |
|---|---|---|
| L1 | A dead harness is restarted on its own, and the conversation, its history, and its spend survive. | `TestTheHarnessRestartsAndKeepsItsHistory` |
| L2 | A run interrupted by a crash finishes afterwards. | `TestAnInterruptedRunFinishesAfterARestart` |
| L3 | The stream carries a full state on attach and whenever it moves, whole transcripts as view frames, and a keepalive that arrives while nothing is happening. | `TestTheStreamSendsStateViewsAndKeepalives`, `TestTheStreamAnnouncesStateChanges` |
| L4 | A failure says what the harness said, not only that it exited. | `workerpool.TestLastWordsPrefersTheLineThatExplains` |
| L5 | A death is announced once, and only for the worker that is running: a notification from one that was already replaced changes nothing and starts nothing. | `TestOnlyTheCurrentWorkersDeathCounts`, `TestTheHarnessRestartsAndKeepsItsHistory` | `TestABrokenWorkspaceFileIsReportedAndHeals` (a failed start restarts exactly once), `TestTheHarnessRestartsAndKeepsItsHistory` |

## Credentials and access

| # | Feature | Test |
|---|---|---|
| P1 | Credentials live in the install folder (0600) and never inside a workspace. | `worker/test/skills.test.ts`, `TestWorkspacesAreIsolatedAndStartOnDemand` |
| P2 | The provider list and each model's thinking levels come from the harness. | `worker/test/protocol.test.ts`, `TestAFreshInstallHasARootConversation` |
| P3 | A non-loopback bind always ends up with a token; loopback needs none; `--insecure` is how you say otherwise. | `httpapi.TestResolveToken` |
| P4 | The token is accepted as a bearer header or as a cookie set by a `?token=` link, and refused otherwise. | `httpapi.TestRequireToken` |
| P5 | Credential reads hand back copies, `modify` returning nothing changes nothing, and `delete` is what removes. | `worker/test/skills.test.ts` |

## The worker protocol

The seam a second harness implements (`docs/adr/0002-layers-and-protocol.md`), tested without a
gateway in the way: `worker/test/protocol.test.ts`.

| # | Feature |
|---|---|
| X1 | Commands are answered by id, and a failure is a response rather than the end of the stream. |
| X2 | `describe` reports the harness, its working directory, providers, and capabilities. |
| X3 | Conversations can be created, listed, opened, renamed, hidden, and forked. |
| X4 | A prompt streams transcripts as whole views and reports submissions. |
| X5 | `expand` rewrites a command into what the model will see. |
| X6 | `policy`, `usage`, `commands`, and `agents` answer with what the interface explains. |

## Fixed by writing these tests

Five things were broken, and the feature tests are what found them. Each has its own test now,
and the fix is in the history rather than a workaround:

1. A conversation could be bound to a model with no credentials, or to a definition that does
   not exist, and failed later as a provider error.
2. Closing a worker did not stop its supervisor, so a workspace whose record changed (trust,
   folder) came back with two harnesses over one storage and the settings that had just been
   replaced.
3. A typo in a workspace's config took the whole gateway down, and the reason was only in the
   log: the interface could not say what was wrong.
4. Recovery created a conversation without listing first, so it made a second one and landed on
   the copy; and it skipped the settings and last-resort model a first start performs, so a
   workspace whose first start failed answered nothing.
5. A workspace that had never saved settings never read the install defaults.

## Not covered, and why

- **Real providers.** Every test uses the scripted one. A provider is a network and someone
  else's availability; what matters on our side is that the binding, the clamping, and the
  refusal are right, and those are covered.
- **The model's judgement.** Nothing here asserts that an agent does something sensible. The
  platform's job is to make the call and record it.
- **The sandbox needs a hypervisor.** One microVM per workspace runs commands and file
  operations, with the workspace mounted at its own path and the global resource folders
  read-only at theirs ([ADR 0012](adr/0012-sandbox.md),
  [ADR 0014](adr/0014-global-resources-in-the-sandbox.md)).
  Everything that can be tested without one is: the environment, the path routing, and the
  refusal run against a fake sandbox, and the policy and the lifecycle against a fake engine.
  The end-to-end tests that use a real workspace — its `AGENTS.md`, `.agents/`, skills,
  commands, guards — run in `make test`: the resource features on the host engine, which needs
  no hypervisor, and the four that exercise the microVM boundary on `make test-sandbox`, which
  fails rather than skips where there is no hypervisor. The worker's file operations and
  streaming execution are exercised against the real SDK there too
  ([ADR 0013](adr/0013-test-tiers.md), [ADR 0015](adr/0015-host-engine.md)).
- **Memory and self-improvement.** Designed, not built (see `docs/adr/`).
- **The interface.** `make ui` drives the interface the gateway serves: the rail and the
  transcript, the resizable splitter that remembers its width, per-pane format toggles and
  copy, the theme toggle, and the phone drawer. The inspector and the settings sheet are
  still being rebuilt (#13), which is why their assertions are not in the suite yet.
