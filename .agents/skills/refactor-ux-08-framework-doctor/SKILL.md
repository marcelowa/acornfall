---
name: refactor-ux-08-framework-doctor
description: Run acornfall's structural health checks over the consolidated ui/ and fix what they flag, before building the approved direction. Step 8 of the refactor-ux chain.
---

# Framework doctor

## When to use it

Right after step 07, same session, never standalone.

## The playbook

1. **This repo's health checks are its own policies, not a generic React doctor:**
   - `bun run check:system` (`ui/scripts/check-system.ts`): arbitrary values, Tailwind's palette,
     primitive reads outside the token file, classes on a screen, and token classes that resolve.
   - `bun run lint` (oxlint), `bun run typecheck` (tsc, strictest), `bun run format:check`.
   - `bun run build:storybook` — every story still renders.
   - `bun test` in `ui/`; `make lint` and `make check` at the root.
   - `make ui` is the browser suite and needs a running gateway and a browser: this sandbox cannot
     run it. Say that plainly rather than implying it passed.
2. **Fix what it flags now**, before step 09 builds on top. Log anything left out of scope with
   the reason.
3. **Check the two things no tool here sees, and write the result down:** every state a screen can
   be in has a story (an un-storied state is an unreviewed state), and the accessibility basics
   hold — visible focus, keyboard paths, reduced motion.

## Exit gate

- [ ] the health checks ran, with their real output
- [ ] everything flagged is fixed or logged with a reason
- [ ] the story-coverage and accessibility notes are written down

Then invoke `refactor-ux-09-build`.

## Why this matters

Building a new direction on an unhealthy tree carries the old problems into the new look, and
finds them later, under the build.
