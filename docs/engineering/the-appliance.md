# The appliance: how 0.10 runs

0.10 changed where the product runs. Before it, every workspace was a microVM on the host, each with
its own engine, its own catalog and its own copy of the runtime. After it, the host launches **one
machine per install**, and everything the product is — gateway, worker, containers — lives inside
that machine. ADR 0022 records the decision; this page records how it works, and what it cost to find
out.

## The model

```
host                                    the machine (one microVM per install)
────────────────────────────────────    ────────────────────────────────────────────────────────
~/acornfall            ← the mount ─────→ /acornfall/workspaces/…   the product's files
~/.acornfall/          the machinery     /var/lib/acornfall/         the appliance's own state
  appliance/<tag>.tar.gz the artifact ──→ PID 1 = the gateway, from the disk below
  machines/<machine>/    the disk: unpacked from the artifact above
  tools/microsandbox/    the engine         └─ worker (bun) ─ lxc ─→ containers for tool calls
  sandboxes/<machine>    the engine's own record of the machine
```

Three rules fall out of that picture and each one cost a bug to learn:

1. **The mount holds what the product is; `~/.acornfall` holds what runs it.** Deleting the second is
   a clean install. Deleting the first is losing the product's files.
2. **The appliance is an artifact and a disk, and they are two things.** The release ships a rootfs
   tarball, which is kept as it was verified (`appliance/<tag>.tar.gz`); the disk a machine boots
   (`machines/<machine>/rootfs`) is unpacked from it. One directory was both, which is how a
   previous machine's containers ended up in the next machine's image, and how a fetch replaced the
   disk of a machine that was using it. `machine down` takes the disk and keeps the artifact.
3. **The console and the containers are different sandboxes.** The console runs in the machine. Tools
   run in containers inside it, which have their own `/dev`, their own network and their own config.

## The pieces

| Piece | What it is | Where |
|---|---|---|
| appliance artifact | Debian-stable rootfs + the gateway binary + the worker sources and its production `node_modules` | built by `scripts/build-appliance.sh`, shipped as `appliance-linux-amd64.tar.gz` (~155 MB), kept verified at `~/.acornfall/appliance/<tag>.tar.gz` |
| machine disk | the artifact unpacked onto a real filesystem, the machine's to dirty | `~/.acornfall/machines/acornfall-machine-<hash>/rootfs` |
| engine | microsandbox `0.7.6`, the hypervisor wrapper | fetched by the launcher, pinned per release |
| machine | one microVM, booted from the image, with the mount passed in | `acornfall-machine-<hash>` |
| gateway | PID 1 inside the machine, serves the console and the API | `--in-machine --sandbox-engine lxc` |
| worker | bun, the agent runtime, spawns the container engine | inside the machine |
| container | one per workspace, lxc, unprivileged by default | `acornfall-<workspace>-<hash>` |

The launcher (`machine up`) does four things and no more: fetch the release's tarball if the version
is new, verify it against the release's checksums, unpack a disk from it if the machine has none for
that release, boot it, publish its port. Everything after that is the machine's. An install that
already has the tarball makes a machine with no network at all, and an install from before this
layout keeps booting its own image directory (`appliance/rootfs`), which the launcher never deletes
and never writes into.

## The host service, and the channel it reads

The launcher is also a service: `acornfall machine serve` ([ADR 0030](../adr/0030-the-host-supervises-the-machine.md))
starts the machine at boot, restarts it when it exits with backoff and a cap, and applies the
release the product asks for. Unit files to copy are in `scripts/units/`; nothing installs them.

The two sides talk through the mount, because the mount is the one thing both can reach:

```
~/acornfall/state/host/want.json   the product writes  { "version": "v0.10.0-beta.14" }
~/acornfall/state/host/is.json     the service writes  { "running": true, "version": "v0.10.0-beta.13",
                                                         "service": "…", "lastError": "", "at": "…" }
```

Both are written whole and renamed into place, and both are read tolerantly: a missing, empty or
unparsable file is "nothing declared yet", never an error the console shows. `want.json` is the only
thing the machine can ask for and it carries one release tag — a value that is not one is refused by
name in `is.json.lastError`, and a tag that names no release is refused before anything is fetched.

An apply is ordered so that a failure costs nothing: the release's artifact is fetched and verified
with the machine untouched, the new disk is unpacked beside the live one, and only then is the
machine taken away and the disk swapped in. If anything before the swap fails, the machine that is
running stays running and `is.json` names what failed.

## Boot, and why the gateway is PID 1

The engine has no entrypoint for a plain rootfs, so the launcher passes an interpreter and a script:

```
--init /bin/sh --init-arg -c --init-arg <script>
```

The script is where the machine's assumptions are made explicit, because an image is *files*, not a
running system:

- the appliance's `/dev` nodes are created (`null`, `zero`, `full`, `random`, `urandom`, `tty`) — an
  unpacker running as a user cannot create device nodes, so a tarball has none
- the gateway is started with `--in-machine`, which tells it the containers are the machine's own and
  the shim runs in-process over a `net.Pipe` instead of over a socket to a separate process
- the gateway binds `0.0.0.0:7777` *inside* the machine, because the engine's port forward cannot
  reach the guest's loopback; the host side stays on `127.0.0.1` unless `--host` says otherwise
  ([ADR 0025](../adr/0025-the-launcher-publishes-on-loopback.md))

## The container's two `/dev`s

This is the bug that took a day, so it is written as the rule it should have been:

- **the machine's `/dev`** is the image's `/dev`, filled in by the init script above
- **the container's `/dev`** is made by lxc: `lxc.autodev = 1` mounts a devtmpfs and creates the nodes,
  which is why `/dev/null` inside a container is owned by `nobody:nogroup`

Both can exist and `lxc-attach` can still fail: it opens `/dev/null` **before** it enters the
container's namespaces, so the open is subject to the **container's device cgroup**. With no
`lxc.cgroup2.devices.allow` list that open returns `EPERM`, lxc prints
`open_devnull: Operation not permitted`, and then runs the command anyway. Every working command
carried a line that read like the reason it could not run.

The fix is the allow list — `c 1:3` (null), `c 1:5`, `c 1:7`, `c 1:8`, `c 1:9`, `c 5:0..2`, `c 136:*`.
Filtering the message would have hidden a real permission denial.

## Lifecycle and the states that lie

`up` → `status` → `stop` → `down` → `restart`. The one that matters is `down`: it removes the
machine's disk, so the containers go with it. That is why it is also the repair for a machine whose
container will not start.

Four states have lied during this beta, each in a message that was true about something else:

| Message | What it actually meant |
|---|---|
| `open_devnull: Operation not permitted` | the container's device cgroup, not a missing node |
| `capabilities.sandbox: "local-process"` | a hardcoded string, while the container was running |
| `capabilities.sandbox: "microsandbox"` | the *store*'s engine name, not the driver's |
| `lxc-start: Received container state "ABORTING"` | the container was **already running**; a second start is an error |

The rule that comes out of it: **check the effect before believing the message.** `lxc-ls` said
RUNNING through all four.

## Upgrading replaces the image

The image is the machine's disk, so a machine boots from whatever that directory holds — including
the containers a previous machine left in `var/lib/lxc`. The launcher used to keep any image whose
two files were present, so an upgrade booted the old appliance with the new launcher: the product
inside said one thing and the binary outside said another. A container the runtime could not read
then failed the shim's list, every workspace said "this workspace has no sandbox", and the only cure
was a clean install, because nothing in `machine up` ever replaced a byte.

An image now names the release it is in `/etc/acornfall-appliance`: the build writes it when it is
told the tag, and the launcher stamps it after a fetch, because it verified that release's checksum.
An image that does not say — one built before the mark carried a release — is replaced like an old
one. A replaced image is a machine that has to be made again, and that is the point: the new image
arrives without the containers the old one accumulated. `--image` names the person's own tree and is
never compared or replaced.

The other half is the shim's list: a container that is there and cannot be read is reported with the
runtime's own words, and only the workspace that owns it refuses. One bad container used to be every
workspace's outage.

## Resources

Ceilings and shares, never reservations:

- `memory.max = min(ask, machine memory / 2)`, `memory.high` at three quarters of that
- `cpu.weight = CPUs × 100`, proportional
- a container's default is unprivileged; a workspace can ask for the privileged profile, and both
  configs are pinned by tests because the differences between them are the point

## Release and CI

- `binaries` (4 platforms) → `appliance` (built inside a microVM, so the runner needs no root) → `publish` → `prove`
- `prove` boots the published tarball with the install's own code, and runs `machine up` with the
  published binary as an unprivileged runner user — the artifact proving itself before anyone installs it
- `prove.yml` runs the same boot on a branch push from the appliance the runner keeps on disk, so a
  fix is tested in minutes rather than a release cycle. On a hash the runner has not seen it **warns
  and skips the boot**: the run is green and nothing booted ([ADR 0024](../adr/0024-a-release-proves-its-own-artifact.md))

A tag is one pass now: each job uploads what it built to the release's own draft, and `publish`
assembles the checksum file from what the producers left on the runner, so no artifact storage sits
between two jobs on one disk. A tag took 27m43 before that and 6m57 on beta.14.

## What is still open

- **engine/catalog conflict**: the Go side and the worker have shipped different engine versions, and
  a newer engine migrates the shared catalog beyond what the older one can read. One version across
  both layers, or a catalog per layer.
- **the sign-in stall**: the console can enter "Starting api key…" before anything is pasted. Needs a
  log from the moment it happens.
