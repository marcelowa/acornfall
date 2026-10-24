# 0035. A workspace's home is a folder, not the repository

Status: proposed, 2026-10-24 — built (`Policy.Home`, `DefaultHome`, `ContainerHome`, `bindAt`),
pinned by unit tests, and the release proof writes to `~` and reads the bytes back from the share.
Date: 2026-10-24

## Context

ADR 0021 gives a workspace an unprivileged container, and acornfall#98 gave that container a
passwd entry for the uid its tools run as. The first version of that entry named **the workspace**
as home, on the reasoning that a path should mean the same thing in both worlds.

It does, and that is the problem. `~` is where a tool writes its own settings — `.gitconfig`,
`.ssh/known_hosts`, a package manager's cache, `cargo`'s registry. A workspace is a repository
whose `git status` belongs to whoever owns it. Measured on the install this repository is
developed in, within a minute of the entry landing:

```
$ ssh -T git@github.com
debug1: load_hostkeys: fopen /srv/acornfall/workspaces/acrornfall/.ssh/known_hosts: No such file
```

ssh expands `~` from the passwd entry, not `$HOME`, so it went looking for a key inside the
repository. The workaround was absolute paths in a config plus `GIT_SSH_COMMAND` — three
environment variables to correct one field, and every workspace would have needed them.

## Decision

1. **The home is a folder of its own**, `ContainerHome = /home/acornfall`, bound from
   `<workspace>/.acornfall/home`. The workspace is still mounted at its own path, unchanged: a
   path means the same thing in both worlds, and `~` is simply not the workspace.
2. **It is a bind, not a folder in the rootfs**, for the same reason the prefix is (ADR 0034): a
   home inside the rootfs is thrown away with the container, and settings are the thing a person
   expects to survive.
3. **The path is the engine's, not a policy's.** Unlike a prefix it is not in `PrefixTargets`: a
   workspace does not get to choose where `~` is, and the target is a constant.
4. **The policy names the source**, as it names prefixes and globals: `Policy.Home`. Empty leaves
   the image's home alone, which is what every caller before this ADR had, and what the tests
   that build a raw policy still get.
5. **The share-root rule is unchanged**: `bindAt` goes through `bindPath`, so a home at the root,
   outside the root, or over `config/` is refused exactly as any other bind would be.

## What it buys

- **`git status` stays the user's.** Nothing a tool writes to `~` appears in the repository.
- **Settings survive the container.** The home is in the share, so `.gitconfig` and `.ssh` are
  still there after a remake.
- **The workarounds go.** No `GIT_SSH_COMMAND`, no absolute-path ssh config: `~/.ssh` is where
  every tool already looks.
- **One mechanism, three uses.** The workspace, the prefixes, and the home are all "a folder of
  the share at a path in the container"; `bindAt` is now the one way to say that.

## The price

- **Another folder in the workspace.** `<workspace>/.acornfall/home` sits beside
  `.acornfall/prefix`, and inherits ADR 0034's open question: it is only invisible to `git` in
  repositories that ignore `.acornfall/`.
- **`HOME` is the container's, not the caller's.** The exec clears the environment and refills it,
  and a caller that passes the machine's own `HOME=/` turns every `~` into the root of the
  container's filesystem — measured on beta 60 to 62: the home bind was mounted and
  `~/home-proof.txt` landed in the rootfs, because the environment said `/`. The shim now reads
  the container's own passwd for the uid it is about to run as and sets `HOME` from it, dropping
  any `HOME` the caller sent. A container whose passwd cannot be read keeps the caller's.
- **An image that already has a home keeps it.** The entry is written only when the uid is
  unnamed (acornfall#98), so an image with `node:x:1000:1000:…:/home/node` keeps `/home/node`,
  and this bind is then a folder nothing points at.

## Alternatives

- **`~` is the workspace** (what #98 first did). One path fewer, and every tool's settings land
  in the user's repository.
- **`~` is `/` or `/root`.** Inside the rootfs: thrown away with the container, and `/root` is
  not writable by an unprivileged uid.
- **A `$HOME` environment variable only.** Works for programs that read it, not for ssh(1) or
  anything else that calls `getpwuid`, which is the case that started this.
- **Bind the user's real host home.** It is outside the share, so the machine cannot see it, and
  it would hand a container every dotfile the person owns.

## Consequences

- `sandbox.Policy.Home`, `DefaultHome`, `ContainerHome` (`policy.go`); `bindAt` (`layers.go`),
  which `prefixBind` now calls; the derivation in `control.Workspaces.SandboxPolicy`.
- `CreatePayload.Home` is the container's path, not the workspace's; the passwd entry names it.
- Tests: the target is fixed and read-write, a policy without a home is left alone, a home
  outside the share is refused, the default is not the repository — plus the release proof, which
  writes to `~` inside the container and reads the bytes from `<workspace>/.acornfall/home`.
