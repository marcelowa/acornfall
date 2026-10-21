# ADR 0020 — The tailnet is the only transport

Status: proposed, not built
Date: 2026-10-15

## Context

Reaching a workspace from another machine needs a network the user already has: a tailnet
bind (`make dev`) or an SSH tunnel. Both want an install or an account per device, and
neither gives one name per workspace.

The decision to publish the product is what forces the question. The owner's rule settles it:

> URLs work only for the authenticated user. A device with nothing installed must not
> reach them.

That rule kills the shape this ADR was first drafted around — a hosted relay with a
no-install browser URL — and leaves one transport: the tailnet. A device joins, or it sees
nothing.

What the code already decides:

- The gateway owns the transport edge: auth, framing, backpressure, rate limits
  ([ADR 0002](0002-layers-and-protocol.md)). The node belongs in that layer.
- Tools run inside the microVM ([ADR 0012](0012-sandbox.md)). A dev server the agent starts
  listens in the guest, at `172.16.0.10`, with the host at `172.16.0.9`. The tailnet
  replaces the last hop only; the guest port is still the gate.
- The guest can reach the gateway's own API today, a known limit of ADR 0012. Nothing here
  widens it: publishing a port stays the user's act.
- The console reconnects by design ([ADR 0009](0009-liveness-and-recovery.md)), so the
  control plane may drop streams whenever a key or ACL changes and nothing in the interface
  needs to know.
- The interface's multi-user pass is a foundation, not features (design.md): tokens,
  journeys, screens without classes. The names surface lands on it.

## Vocabulary

| Term | Meaning |
|---|---|
| **Tailnet** | The private network every joined device is in. The only way in. |
| **Node** | One machine or process on the tailnet, with its own key pair. |
| **Coordination** | The control server: accounts, devices, public keys, ACLs, names, relay map. Not in the data path. |
| **Relay** | The blind fallback for pairs that cannot connect direct. Bytes it cannot read. |
| **Publication** | A name and a port a workspace publishes to its own tailnet: `ws1-api` → gateway → guest port. |
| **Zone** | A user's name space: `user1.acornfall.dev`. |

## The decision

**One transport: the tailnet.** A device joins, or it sees nothing. No anonymous access, no
public URLs, no machine tokens for outside callers, no browser path for a device that
installed nothing. Every protocol, every port, the same way in.

**Accounts are ours.** Coordination runs on headscale (open source, Go, multi-user, OIDC,
ACLs, DNS) behind our own sign-in: the account lives in this system, never in someone
else's. Tailscale's client asks our server for its peers, and its private key never leaves
the device. The hosted coordination server sells onboarding, names, and uptime — not
private data it cannot read anyway.

**Any port, any protocol.** No `http`/`tcp` split, no relay port allocation, no per-request
ownership check, no certificate reading traffic in the clear. A joined device reaches a
port because it is in the network.

**One node per gateway, one per device.** Not per workspace: ten workspaces are still one
node, and the sandbox gets no node at all. A user's laptop, phone, and CI box are one node
each.

**The direction: the gateway runs its own node, embedded.** `tsnet` inside the gateway
process: userspace, no root, no daemon, no tailnet interface on the host, and the node's
identity is the install's identity. Until that lands, the system client on the host does
the job and the gateway binds the tailnet address — today's shape, kept working.

**User devices run the system client, pointed at our coordination server.** Linux, macOS,
Windows, and the CLI do this today. The store builds of the mobile clients refuse a custom
control server, so phones need our own app before phones have this. Desktop first.

**Names come from the control plane.** The owner's shape, kept: `user1.acornfall.dev` for
the account, and one label under it per publication — `ws1.user1.acornfall.dev`,
`ws1-api.user1.acornfall.dev`. The control plane writes the record, pointing at the
gateway's node, and one wildcard certificate per zone covers the labels. The zone's DNS
stays public with private addresses, so ACME DNS-01 still issues real certificates; a small
CA on joined devices is the alternative. Undecided, below.

**The relay survives as blind plumbing.** When two peers cannot connect direct, a relay
carries WireGuard bytes it cannot read. It is not a product, it is not a URL, and it is the
one place traffic costs us bandwidth. Run our own, in more than one region.

**Keys stay on devices.** Coordination holds public keys, names, and ACLs. It never holds a
private key and never sees payload.

**Self-hosting stays first class.** The same two halves, the user's own coordination server,
and the gateway pointed at it with one flag.

## The gate before the build: the guest port

A publication must reach the port the tool listens on, and that port is inside the microVM.
Three candidate paths, in order of preference:

1. the engine's port map, if it has one;
2. a host dial to `172.16.0.10`, which the `/30` layout suggests but does not promise;
3. a small forwarder inside the guest that dials out, started by the worker.

One must be proven on Linux/KVM with a real dev server before any of this is built.
Host-engine workspaces ([ADR 0015](0015-host-engine.md)) have no such question — their
ports are host ports — which is why publishing them is its own decision, with its own
warning.

## Phases

1. **Tailnet as a transport, no server of ours.** Detect an existing tailnet, publish
   workspace names and ports onto it, show the URLs in the console. Works on top of the
   system client and today's shape.
2. **Coordination we host.** Accounts in our system, headscale behind our sign-in,
   `acornfall join` and device approval, the names written by the control plane.
3. **Our own node in the gateway** (the direction), then our own desktop client, then
   mobile — embedded node in-process first, system-wide access later.
4. **Self-host runbook** and the operations story for relays.

## Alternatives

**The relay product, as first drafted here.** Outbound tunnel, no install, a URL anyone
could open. Rejected by the owner's rule, and by its own arithmetic: once the URLs are
authenticated-only, the relay is a worse tailnet — it reads HTTP traffic, needs sessions,
devices, certificates, quotas, and abuse handling, and pays bandwidth for every byte. The
earning kept: blind relay as NAT fallback.

**Public and shared URLs, machine tokens, one-time links.** Same rule. A GitHub webhook is
a device with nothing installed, so webhooks are out. Sharing waits for real teammates on
the same tailnet.

**A third-party tunnel as the destination** (Tailscale's own service, cloudflared, ngrok).
Kept as a stopgap only. Each wants an account somewhere else, gives no per-workspace names,
and teaches every user a different tool — and Tailscale's service puts the account back in
someone else's system, which is the thing being avoided.

**A node per workspace.** Rejected: N keys, N clients, N updates, N reconnects, and one
lifecycle more than the feature needs.

**Writing the client and the coordination protocol from scratch.** Rejected: the client is
open and coordination is headscale. What is ours is the account layer, the naming, and the
console.

**Using `wireguard-go` directly.** Rejected: it is the engine inside the client. Alone it
decides nothing — no discovery, no NAT traversal, no relays, no names — so that path means
owning all of it.

## Consequences

- The client install is the entry fee, and `acornfall join` has to make it one command.
- No webhooks, no URLs handed to a person who has nothing installed, no borrowed laptop.
  Accepted with the rule, and it is the part users will ask for first.
- Coordination becomes the front door: joins and key changes need it up, live connections
  do not.
- The abuse surface nearly disappears. No anonymous entry means not being an open proxy;
  the remaining limits are quotas on relay fallback bandwidth.
- Two costs we now own: hosting coordination and hosting relays. Both are small, neither is
  free.
- Branding and licenses: no Tailscale marks on anything we ship, notices kept, and the
  mobile app is ours to build and review.
- A publication must follow its sandbox's life: stop the sandbox and the name answers with
  what the state says; start it and the name resumes.

## Open questions

1. The guest port, above. Everything else is downstream.
2. Certificates: public zone with private records and ACME, or an internal CA on joined
   devices.
3. Phones: build the app early, or launch desktop-only and say so.
4. Client distribution: the official client configured by `acornfall join` first, or our own
   build with the control URL baked in.
5. The license of acornfall itself, now that a paid tier is planned: permissive, AGPL, or a
   permissive client with a server that is not.
6. Relays: how many regions, and whether the free tier gets one.
7. Teammates: ACLs per workspace later, or one account per person with all their own
   workspaces only.
