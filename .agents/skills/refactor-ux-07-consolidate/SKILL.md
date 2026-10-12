---
name: refactor-ux-07-consolidate
description: Consolidate duplicated components and one-off patterns in ui/ before building the approved direction on top of them. Step 7 of the refactor-ux chain.
---

# Consolidate

## When to use it

Right after step 06, same session, never standalone.

## The playbook

1. **Inventory the near-duplicates.** `ui/src/components/` holds the groups (composer,
   conversation, inspector, layout, settings, transcript, typography, ui, workspace);
   `ui/src/screens` and `ui/src/app` hold the composition. Look for the same control implemented
   twice, button or row variants that drifted, spacing and focus treatments written at each call
   site, and anything a screen does that a component should own.
2. **One implementation per pattern.** A screen carries zero classes (ADR-0016): a screen that
   needs a style it cannot compose is a missing component, not a screen problem.
3. **Keep this pass structural.** Apply the approved direction where it is free, but do not
   relitigate step 06 here.
4. **Record every merge in `docs/ui-workflow/refactor-ux/07-consolidation.md`** — what merged,
   what stayed, and why.
5. **Verify nothing broke:** in `ui/` run `bun run typecheck`, `bun run lint`, `bun test`, `bun
   run build:storybook`; at the root run `make lint`.

## Exit gate

- [ ] duplicated patterns sit on one implementation each
- [ ] typecheck, lint, ui tests, storybook build, and check-system pass

Then invoke `refactor-ux-08-framework-doctor`.

## Why this matters

A new coat on five duplicate buttons is still five buttons. Step 09 should change one place per
pattern, not five.
