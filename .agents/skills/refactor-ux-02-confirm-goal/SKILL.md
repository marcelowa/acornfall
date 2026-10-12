---
name: refactor-ux-02-confirm-goal
description: State acornfall's purpose and what "working well" means back to the user and get it corrected, before designing anything against it. Step 2 of the refactor-ux chain.
---

# Confirm the goal

## When to use it

Right after step 01, same session, never standalone.

## The playbook

1. **Explore enough to state the purpose as a claim.** Read `README.md`, `docs/features.md`,
   `docs/adr/0016-the-interfaces-design-system.md`, `docs/ui-workflow/99-ui-design-spec.md`, and
   enough of `ui/src` to know what the console actually does. Don't just ask the user.
2. **Write the goal statement to `docs/ui-workflow/refactor-ux/02-goal.md`** as a claim, not a
   question: "acornfall is X, for Y, succeeding when Z" — concrete enough to be wrong.
3. **Put the foundation question in the statement.** The operator today is one technical owner;
   the interface must later carry a multi-user platform without a rewrite. This pass owes that
   foundation, not multi-user features.
4. **Let the user correct it, and restate until they stop correcting.** "Sounds about right" is
   not confirmation: ask for the specific correction.
5. **Do not propose journeys, palette, or layout here.**

## Exit gate

- [ ] the goal statement is written down and matches the user's intent in their own words
- [ ] the foundation limit (foundation now, multi-user later) is in it

Then invoke `refactor-ux-03-draft-journeys`.

## Why this matters

Every later step is decided against this statement. A wrong goal does not fail loudly: it produces
a console that is consistent and wrong for its owner.
