# ADR 0025 — The launcher publishes on loopback, and says so when it doesn't

Status: accepted, 2026-10-21
Date: 2026-10-21

## Context

ADR 0022 left the host one job: boot the machine and publish the one port the console uses. That
port is therefore the product's **whole** network edge — there is no other door into an install.

What sits behind it is a console started with `--insecure` in this build, because the appliance has
no secrets of its own and the mount is the only place a token could live (`applianceInit` reads
`<root>/config/token`, and most installs do not have one). An unauthenticated console is not a page
someone can read: it is a shell with the user's files, the provider key, and tool execution.

The first shape published `127.0.0.1` and nothing else. That is right for the person at the
keyboard and wrong for the owner's own box: `acornd` is a Proxmox VM, so reaching the console from a
laptop meant an SSH tunnel per device, per session. `--host` exists because of that, and the
question behind it is: where does the port bind, and what does the launcher say when the answer is
"not loopback"?

ADR 0022 recorded this as an open price — "the host publishes a port, and ADR 0020's *the tailnet is
the only transport* needs a look at where that port binds". This is that look.

## Decision

1. **`machine up` publishes on `127.0.0.1` by default.** `--host` takes any address, and the default
   is the one that cannot surprise anyone.

2. **`--host` is the bind address, not a filter.** It becomes the first field of the engine's own
   forward (`BIND:HOST:GUEST`, `internal/sandbox/machine.go`), so it is the whole of where the
   console is reachable. Nothing sits in front of it doing access control.

3. **A non-loopback address says one line, on stderr, and proceeds.** The line names host and port,
   because `0.0.0.0` without a port is not somewhere anyone can go (measured: the first version
   named only the address). It says which of the two authentication situations this install is in:
   with a token in the mount the console asks for it; without one it asks for nothing. A warning
   that cries "no authentication" over an install that has a token is a warning people learn to
   skip. It is not a prompt and not a refusal: a lab VM and a tailnet are real places to want this,
   and a script that publishes a console must keep working.

4. **The address printed is one a browser can open.** The wildcard is replaced by `127.0.0.1`, and
   an IPv6 literal gets its brackets — `http://::1:7777` names a port that does not exist
   (`consoleURL`).

5. **Loopback does not mean "no auth layer".** The token machinery is unchanged
   (`httpapi.ResolveToken`: explicit, then env, then a generated one persisted beside the state). The
   appliance is started with `--token <mount token>` when the mount has one and `--insecure` when it
   does not — never both, pinned by `TestTheApplianceUsesTheMountsTokenOrNothing`.

6. **The address is fixed when the machine is made.** The forward is part of the machine's own
   configuration (its init is fixed at boot), so changing `--host` or `--port` means removing the
   machine: `machine down && machine up`, or `machine up --refresh`.

The three hops, and who decides each:

| Hop | Binds | Decided by |
|---|---|---|
| the appliance, inside the machine | `0.0.0.0:7777` | the appliance's own init. It has to: the engine's port forward cannot reach the guest's loopback |
| the engine's forward, on the host | `<--host>:<--port> → 7777` | the launcher. This ADR |
| the URL a person opens | `http://<browsable>:<--port>` | the launcher, in `consoleURL` |

## Alternatives

- **Publish on `0.0.0.0` by default.** Convenient on a VM, and it turns every install into an
  unauthenticated console on whatever network it is plugged into, before the person has decided
  anything. Rejected.
- **Refuse a non-loopback address.** Forces an SSH tunnel or a reverse proxy for every use that is
  not the keyboard — including the owner's own box, which is what made `--host` exist. Rejected:
  the person who owns the machine is the one asking.
- **Mint a token before publishing anywhere.** The better end state: the launcher calls
  `httpapi.ResolveToken` itself, writes `<root>/config/token`, passes `--token`, and any address is
  fine. Not chosen now because it changes the console's first-run story — the token would have to be
  shown on the console or in the launcher's output, and the sign-in flow is one screen short of
  usable in this build (see the open "Starting api key…" stall). The code is there and the path is
  short; what is missing is a decision about where a person reads their token.
- **Publish on the tailnet address by default** (where ADR 0020 points). Right once a tailnet
  exists; wrong before it does, and it would make showing a page locally depend on a network service.
- **Put a proxy in front of the port** — an access layer outside the appliance. It hides the wildcard
  instead of deciding it, and it adds a second thing to install and keep. Rejected.

## Consequences

- The default is a console only the person at the keyboard can reach. Another device needs
  `--host <tailnet address>` — which is ADR 0020's path, chosen by hand — or a tunnel.
- The wildcard still exists one hop in, inside the machine. Only the forward reaches it, so the
  launcher's decision is the one that counts.
- ADR 0020's "the tailnet is the only transport" is not the default yet. It is the mode that
  `--host <tailnet address>` selects, and the distance between the two is a token, not a transport.
- The notice is one line per `machine up`. Nothing reads it back, and no test asserts what a person
  sees on a terminal; the two functions behind it are pinned
  (`TestTheConsoleURLIsOneABrowserCanOpen`, `TestPublishingOffLoopbackSaysWhatIsTrue`).
- **Known limit, not yet fixed:** on a machine that already exists, `--host` and `--port` change
  nothing — the machine keeps the forward it booted with — but `machine up` still prints the
  requested address and waits on it. With a changed `--port` that is a `--wait` timeout and a
  failure that names the wrong port. The repair is the same `machine down`, and the fix is to record
  the published address and report it; that needs a decision (report, or recreate), so it is not in
  this one.
