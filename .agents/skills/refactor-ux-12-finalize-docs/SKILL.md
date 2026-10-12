---
name: refactor-ux-12-finalize-docs
description: Write the shipped direction into design.md and icp.md at the repo root, mirror the chain into the repo, and hand off to a simplify pass. Step 12 of the refactor-ux chain.
---

# Finalize the docs

## When to use it

Right after step 11, same session, never standalone.

## The playbook

1. **Write `design.md` at the repo root** — the palette from step 05 and why it fits this operator,
   the type and layout direction as shipped, and the journeys from step 03 as the product's defined
   paths. It states the direction, not a description of whatever the code happens to do, and it
   says what a later multi-user platform can build on. Point at the evidence:
   `docs/ui-design-spec.md`, `docs/ui-workflow/`, ADR-0016.
2. **Write `icp.md` at the repo root** — the final persona set (the three modes), the feedback
   format, what each approved in both passes, and why no multi-user persona is in it yet.
3. **Mirror the chain into the repo:** copy `.agents/skills/refactor-ux-*` from the workspace into
   `acornfall/.agents/skills/`, and add `docs/ui-workflow/refactor-ux/README.md` listing the twelve
   steps so the next session finds them.
4. **Mark every todo from step 01 complete.**
5. **Hand off to a simplify pass** over the diff — the repo's `/deslop` prompt — before the change
   goes to review. Commits follow the `conventional-commits` skill, and a UI change carries its
   stories and its check-system run.

## Exit gate

- [ ] `design.md` reflects the direction actually shipped
- [ ] `icp.md` reflects the final personas and what they approved
- [ ] the chain is in the repo and the todos are closed

## Why this matters

A direction that lives only in a chat gets re-derived by the next session. These two files are how
a decided direction outlives it.
