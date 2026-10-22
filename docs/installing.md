# Installing acornfall 0.10

0.10 is the first release where the whole product runs inside one microVM per install. The host
does one thing: it launches the machine. Everything else — the gateway, the worker, the containers
a tool runs in — lives inside it.

## What goes where

| Path | What it is | Survives what |
|---|---|---|
| `~/acornfall` | the mount: workspaces, `config/credentials.json`, the console's token | reinstalls, machine rebuilds, `machine down` |
| `~/.acornfall` | the machinery: the appliance image, the engine, the machine's disk | nothing — deleting it is a clean install |

That split is the design (ADR 0022). The mount holds what the product *is*; `~/.acornfall` holds what
*runs* it. A broken install is repaired by deleting the second and keeping the first.

## Install

```sh
curl -fsSL https://raw.githubusercontent.com/marcelowa/acornfall/main/scripts/install.sh | sh
```

That downloads the release's binary, verifies its checksum, and hands it to `machine install`, which puts
it at `~/.acornfall/bin/acornfall-<version>`, makes `~/.acornfall/bin/acornfall` a symlink to it, writes
the service's unit (systemd on Linux, launchd on macOS), enables it, turns on linger so it starts at boot,
and waits until the console answers. Then open the URL it printed.

**Install is idempotent, and it is also the repair.** Running it again prints `ok` for everything that is
right and `fixed` for what drifted — a unit with the wrong `ExecStart`, a missing symlink, linger off, a
declaration that disagrees with the unit — so an install is the answer to "my service is not starting",
and an upgrade is the same command.

It asks one question, and `--remote` / `--local` skip it:

```
Is this machine reached from another computer? [y/N]
  y: the console is published on 0.0.0.0 and asks for a token
  n: the console stays on 127.0.0.1
```

With no terminal to ask and no flag, it refuses and names both flags rather than guessing a network bind.
`y` makes a token at `~/acornfall/config/token` if there is not one (32 random bytes as hex, 0600), and if
that file cannot be written the remote install is refused — an unauthenticated console on a network
address is the one outcome this must never produce.

```
sh install.sh --local      # the console on 127.0.0.1:7777
sh install.sh --remote     # on 0.0.0.0, with a token
```

The answer is written into `~/acornfall/state/machine.json` beside `wanted`, and into the generated unit,
so the two cannot disagree. `machine status` prints the address, so "where do I browse" has an answer.

## Removing it

```sh
acornfall machine uninstall   # stop the service, remove the unit, the binary, the machine, the artifacts
acornfall machine purge --yes # the same, then the mount and ~/.acornfall: nothing left
```

`uninstall` keeps the mount: the workspaces, the conversations and the files are yours, and nothing in
this product deletes them. It does stop the machine first, and it never removes the disk of a machine that
is running.

`purge` is the only command that destroys work, so without `--yes` it removes **nothing**: it prints every
path it would take, with what is in each, and exits non-zero. That listing is the dry run — there is no
second flag. It runs the uninstall first when the service is still installed, and it prints any workspace
the registry names *outside* the mount without touching it, because those are your own folders.

## Flags

| Flag | Default | Meaning |
|---|---|---|
| `--port` | the declaration's, `7777` | the host port the console is published on. Given, it is written into `state/machine.json` |
| `--host` | the declaration's, `127.0.0.1` | the host address to publish on, written the same way. `0.0.0.0` exposes an unauthenticated console unless a token is there, and `machine install --remote` makes one |
| `--memory` | half the host | the machine's ceiling. Ceilings, not reservations |
| `--cpus` | half the host | proportional shares, not cores held |
| `--refresh` | off | rebuild the machine from a fresh image, keeping the mount |

## Lifecycle

```sh
machine up         # fetch if needed, boot, publish the console
machine status     # is it there, without making anything; prints the declared address
machine stop       # graceful: the appliance is asked to shut down
machine down       # stop and remove the machine's disk; the mount and the image stay
machine restart    # down, then up
machine update     # both steps of an update now, without waiting for the service's own tick
machine serve      # the service itself: started by the unit, not by a person
```

`stop` and `down` differ in one important way: `down` deletes the machine's disk, which is where the
containers live. That is what makes it the answer to a machine in a bad state — and the reason to copy
anything out of a container into the mount first.

## When it says "this workspace has no sandbox"

The console disables tools when the appliance reports no usable sandbox. In order:

1. `curl -s http://127.0.0.1:7777/api/state | grep -o '"sandbox":"[^"]*"'` — it should say `lxc`
2. the machine's log names every failure of this kind:
   ```sh
   MSB=~/.acornfall/tools/microsandbox/*/bin/msb
   MSB_HOME=~/.acornfall/sandboxes $MSB exec "$(MSB_HOME=~/.acornfall/sandboxes $MSB list | grep acornfall-machine | awk '{print $1}')" \
     -- tail -30 /var/lib/acornfall/appliance.log
   ```
3. look for `sandbox for <workspace>: …` — that line is the reason, printed on every failed attempt
4. if the reason is a container that will not start, `machine down && machine up` is the repair: a new
   disk means containers built by the current code, not ones that survived a bad start

Read the *effect* before the *message*. `lxc-attach` prints `open_devnull: Operation not permitted`
before it enters a container's namespaces and runs the command anyway, and a container that lxc
reports as `ABORTING` is usually one that is already running. Both have cost hours.
