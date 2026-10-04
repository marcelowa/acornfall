# ADR 0003 — Provider credentials and the login flow

Status: accepted, partially implemented
Date: 2026-10-04

## Problem

Pi's `/login` is a terminal flow that writes `~/.pi/agent/auth.json`. Acornfall has no
terminal, a browser UI, and a headless worker. We need to know where credentials live,
who runs login, and who refreshes.

## What pi-ai already gives us

- `Models.login(providerId, type, interaction)` runs a provider-owned login flow and
  returns a `Credential`. Both API-key and OAuth flows are written against
  `AuthInteraction`, which is **a UI protocol, not a terminal API**:
  `prompt({text|secret|select|manual_code})` and
  `notify({info|auth_url|device_code|progress})`, with `signal` for cancellation.
- `createModels({ credentials: CredentialStore })` — persistence is injectable.
- `CredentialStore` contract: `read` / `list` / `modify` / `delete`, where `modify` is
  the only write path, and **`Models.getAuth()` performs OAuth refresh inside `modify`**,
  so mutual exclusion per provider id, cross-process included, prevents two workers from
  double-refreshing a rotated token.
- `filterModels(models, credential)` — per-credential model availability.
- `AuthResult.source` — a human label ("OAuth", "OPENROUTER_API_KEY") for status UI.

Therefore: **refresh is lazy and needs no scheduler**, and adding a provider requires no
changes in Go and none in the UI.

## Decision

Credentials are owned by control, stored as opaque pi-ai `Credential` blobs keyed by
(user, provider). Go never parses them. The worker receives a `CredentialStore`; it does
not read `~/.pi/agent/auth.json`, does not read ambient provider environment, and does
not understand `models.json`.

The model binding sent to the worker is therefore **not** a credential:

```json
{ "provider": "opencode-go", "modelId": "…", "thinkingLevel": "high", "instructions": "…" }
```

Credentials resolve at request time through the store. Rotation is invisible to sessions
in flight.

### Step 1 (implemented)

A file-backed store at `<data-dir>/credentials.json`, holding exactly the pi-ai
credential map. Control writes API keys into it via `acornfall provider add`. The worker
reads it, and serializes `modify` with an exclusive lock file so two workers sharing the
file cannot double-refresh. This is what pi-ai means by "cross-process too, e.g. a file
lock", and it keeps v0 to one moving part.

`acornfall provider add <provider> <key>` is the v0 onboarding path. It writes
`{"type":"api_key","key":"…"}`. File mode 0600.

### Step 2 (designed, not built)

Replace the file with a store proxy over the worker protocol — `cred.read` / `cred.list`
/ `cred.modify` / `cred.delete` — with control performing a serialized, cross-process
read-modify-write in SQLite. Credentials then live encrypted at rest, and the worker
holds nothing durable.

Login becomes a UI flow: `POST /api/providers/{id}/login` asks a worker in `auth` mode
(same binary, memory storage, no workspace) to call `models.login(...)`, and the
interaction is tunneled to the browser as frames:

| Frame | pi-ai origin | UI |
|---|---|---|
| `auth.prompt` | `prompt({type, message, placeholder?, options?})` | input, password field, or select |
| `auth.event` | `notify({info|auth_url|device_code|progress})` | message, open-tab button, code + poll progress |
| `auth.done` / `auth.error` | login resolution | success or failure |
| `auth.cancel` | `prompt.signal` / `interaction.signal` | cancel one prompt or the flow |

These frames are a 1:1 projection of pi-ai's types on purpose: no translation layer means
a new provider needs no work outside pi-ai. OAuth callback servers, device-code polling,
and PKCE stay in the worker, where pi-ai's provider implementations already are.

`LoginOptions.getDeviceId` comes from control, which persists one installation id.

## Environment variables

Ambient credentials are opt-in and always labeled. If control enables an environment
fallback for a provider, the UI must show the `AuthResult.source` label. A credential
that appears from nowhere produces "why is it billing that account" afternoons.

## What we do not do

- No `auth.json`, no `models.json`, no `/login` in a TUI.
- Provider auth (which key spends money) is separate from product auth (who you are to
  the gateway). Pi fuses them because it is single-user; we do not.
- The worker never writes a credential file of its own.

## Consequence for sandboxing

All model egress credentials sit in one place control owns. When tool egress gets a
proxy, it lands in the same place, with one audit story for both.
