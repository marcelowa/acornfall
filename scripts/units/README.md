# Unit files for the host service

`acornfall machine serve` is the process that keeps the machine up and applies the release the
product asks for ([ADR 0030](../../docs/adr/0030-the-host-supervises-the-machine.md)). It has to
start at boot and survive a crash, which is what an init system is for.

Nothing here is installed by a release, by `make`, or by `machine up`. Each file is a starting
point: copy it, change the path to the binary, and enable it.

| File | For | Enable with |
|---|---|---|
| `acornfall-machine.service` | systemd (Linux) | `systemctl --user enable --now acornfall-machine.service` |
| `dev.acornfall.machine.plist` | launchd (macOS) | `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/dev.acornfall.machine.plist` |

Both assume the defaults: the mount at `~/acornfall`, the machinery at `~/.acornfall`, and the
binary in the user's own path. The Linux one also assumes the user is in the `kvm` group, because
the machine is a microVM.

Two services on one install is not a supported shape: both would reconcile the same machine, and
two processes replacing one disk is a state this design does not have.
