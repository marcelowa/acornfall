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
curl -fsSL -o acornfall-linux-amd64 \
  https://github.com/marcelowa/acornfall/releases/latest/download/acornfall-linux-amd64
chmod +x acornfall-linux-amd64
./acornfall-linux-amd64 machine up
```

`machine up` fetches the appliance (~155 MB), the engine (~93 MB) and boots. It prints
`the console is http://127.0.0.1:7777` and then `the appliance is serving on …` once the gateway inside
answers. The console has no authentication in this build: keep it on loopback.

## Flags

| Flag | Default | Meaning |
|---|---|---|
| `--port` | `7777` | the host port the console is published on |
| `--host` | `127.0.0.1` | the host address to publish on. `0.0.0.0` exposes an unauthenticated console, and the launcher says so once |
| `--memory` | half the host | the machine's ceiling. Ceilings, not reservations |
| `--cpus` | half the host | proportional shares, not cores held |
| `--refresh` | off | rebuild the machine from a fresh image, keeping the mount |

## Lifecycle

```sh
machine up         # fetch if needed, boot, publish the console
machine status     # is it there, without making anything
machine stop       # graceful: the appliance is asked to shut down
machine down       # stop and remove the machine's disk; the mount and the image stay
machine restart    # down, then up
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
