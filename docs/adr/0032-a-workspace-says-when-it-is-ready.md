# ADR 0032 — A workspace says when it is ready, and nothing is created before it is

Status: accepted, 2026-10-22; amended 2026-10-23 — every harness action is refused, not only creation
Date: 2026-10-22

## Context

A workspace exists from the moment it is asked for, and its harness takes a moment to answer: a
process to start, a sandbox to make, a machine to boot on a first run. The console had three separate
facts to read — `workerUp`, `workerError`, `sandbox.problem` — and no rule for what they mean
together, so it offered "New conversation" and a composer the moment the workspace's name appeared.

Three beta releases in a row were found this way, each from the owner's host:

1. a workspace made at a path outside the machine's share had no sandbox, and the console said only
   "tool execution is disabled";
2. a second workspace's container could not start because its bridge address already existed, and the
   console said the same thing;
3. a workspace with no conversation yet was asked for a policy of the empty id, the harness threw
   where its reads were already in flight, and the workspace said "harness down" over a conversation
   the console had just offered to create.

Every one of them is one question: **is this workspace usable yet, and if not, why?** A client that
answers it for itself will answer it differently in each screen, and the person is told to wait for
something that will never come, or invited to act on something that is not there.

## Decision

The gateway reports one field per workspace, `lifecycle`, with a phase and a reason:

| phase      | meaning                                                       | what the console does                    |
| ---------- | ------------------------------------------------------------- | ---------------------------------------- |
| `starting` | nothing has answered yet                                      | says so, and offers nothing that needs a harness |
| `ready`    | the harness is up: conversations, prompts and tools          | everything it has                        |
| `failed`   | the harness went down and has not come back; the reason says why | says why, offers nothing              |

- **A ready workspace may still have an unusable sandbox**, and that is not a phase: it can be talked
  to, and the sandbox panel explains in its own words why tools refuse. Folding "no sandbox" into
  "not ready" would keep the composer off for a workspace whose chat works.
- **Creating a conversation is refused until `ready`**, by the gateway, not only by the console: the
  harness is what makes a conversation, and a write to a harness that is not there is the failure the
  console then has to explain. The refusal is a 409 whose sentence is the phase's reason.
- **The console reads the phase, and nothing else**, for whether to offer an action. The sandbox
  panel keeps its own reading, because its question is different.

## Consequences

- A person sees "this workspace is starting: the harness is starting" where they used to see an empty
  composer and a button that failed.
- A workspace that fails says the harness's own last words in the state, not only in the machine's
  log; the log is still where the detail is.
- A new screen that offers an action gated on a harness has one place to ask.
- The phase is reported for the workspace in view. The rail's rows carry `Running`, which is about
  conversations; a workspace that is starting is not yet a row worth marking, and a per-row phase is
  a later question with its own answer.

## Amendment, 2026-10-23 — every harness action is refused, not only creation

The decision above refused only `Create`. The console refused everything else for itself, so a
client that did not use the console could post a prompt to a workspace that was registered but
starting; it reached the worker, or waited on the first start, and failed with "harness is not
running" instead of the phase's sentence.

The gateway now refuses **every route that needs the harness** with `409 this workspace is not
ready yet: <reason>`. The gate lives in `Control.requireReady` and the HTTP routes resolve the
control without starting it first. `GET /state` and `GET /stream` are the only requests that start
a workspace. `POST /draft` may use a control that is already starting, but never starts one; a
draft is words, not a harness action. Workspace list/create/update/remove, install defaults,
update, and health stay open.

The console still reads the phase and offers nothing that needs the harness; the gateway now
enforces the same rule for every other client.
