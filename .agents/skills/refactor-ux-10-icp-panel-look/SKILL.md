---
name: refactor-ux-10-icp-panel-look
description: Re-run the same personas from icp.md against the shipped look and iterate until every one approves. A gate. Step 10 of the refactor-ux chain.
---

# Panel — second pass, on the look

## When to use it

Right after step 09, same session, never standalone.

## The playbook

1. **Reuse the exact personas from `icp.md`** — the same three modes, the same feedback format. Do
   not redefine them.
2. **Scope this pass to the shipped look** — palette, type sizes, icon and control sizes, spacing,
   motion, phone against desktop — not the journeys, which step 04 already approved.
3. **Spawn one sub-agent per persona against the real thing**, not the step-06 mocks: the built
   stories (`bun run build:storybook`), plus screenshots the user supplies from the running console
   (`make ui` on their machine, where a browser exists). This sandbox has no browser — say what the
   panel actually judged.
4. **Iterate:** revise, re-run, repeat until every persona approves. Disagreement you cannot settle
   goes to the user, not into a silent override.
5. **Record the pass in `docs/ui-workflow/refactor-ux/10-panel-look.md`** — what each persona said,
   what changed after.

## Exit gate

- [ ] every persona reviewed the shipped look, naming what it judged
- [ ] every persona approves

Then invoke `refactor-ux-11-final-pass`.

## Why this matters

A build that matches its mocks can still read cramped or loud once real content fills it. The same
reviewers, on the real thing, catch what mocks could not.
