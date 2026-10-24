# 0023. The container owns its `/dev`, and the harness allows it

Status: accepted, 2026-10-21

## Context

Every command that ran inside a workspace's container printed one line before its output:

```
lxc-attach: acornfall-general-860ad3c0: ../src/lxc/utils.c: open_devnull: 1345
  Operation not permitted - Can't open /dev/null
```

The command worked. `/dev/null` existed in both namespaces — `crw-rw-rw- 1,3` on the machine, and
inside the container `crw-rw-rw- 1,3 nobody nogroup`, created by `lxc.autodev`. The error was `EPERM`,
not `ENOENT`, which is the distinction that matters and that the message hides: a *permission* refusal
reads like a *missing file*.

`lxc-attach` opens `/dev/null` before it enters the container's namespaces. That open is therefore
subject to the **container's device cgroup**, and with no `lxc.cgroup2.devices.allow` list there is
nothing to open it with.

Two fixes were possible.

## Decision

The container's configuration carries the device allow list that a container's init and lxc itself
need:

```
lxc.autodev = 1
lxc.cgroup2.devices.allow = c 1:3 rwm     # null
lxc.cgroup2.devices.allow = c 1:5 rwm     # zero
lxc.cgroup2.devices.allow = c 1:7 rwm     # full
lxc.cgroup2.devices.allow = c 1:8 rwm     # random
lxc.cgroup2.devices.allow = c 1:9 rwm     # urandom
lxc.cgroup2.devices.allow = c 5:0 rwm     # tty
lxc.cgroup2.devices.allow = c 5:1 rwm     # console
lxc.cgroup2.devices.allow = c 5:2 rwm     # ptmx
lxc.cgroup2.devices.allow = c 136:* rwm   # pty range
```

We did **not** filter the message, and we did not silence lxc's stderr.

## Alternatives

**Filter the line from stderr.** Three attempts were made — in the worker's exec, in the shim's exec,
and in the console's renderer. None silenced it, because none of them was where it was printed; and
even the correct filter would have hidden a genuine permission denial that will matter the day a
container needs a device that is not on the list. The message is the symptom of a real policy gap.

**Run the container privileged.** It would have removed the cgroup limit entirely. Rejected: the
default must stay unprivileged (ADR 0017), and a fix that requires giving up the default is not a fix.

**Bind the machine's `/dev` into the container.** It would have made the open succeed for the wrong
reason — the host's device nodes handed to a container whose cgroup would still refuse them, and a
weaker isolation boundary.

## Consequences

- Every command in a container runs without a leading error line, so the line is again worth reading
  when it appears.
- The allow list is a deliberate, small surface: six nodes and the pty range. Extending it is a
  visible change in a pinned test, which is where the next person will look.
- A failing command still carries everything lxc says, because the filters we kept only drop the line
  when the command exited zero.
- The lesson recorded in `docs/engineering/the-appliance.md`: `EPERM` versus `ENOENT` is the whole
  diagnosis, and a message that names a file it could not open may be describing a cgroup.
