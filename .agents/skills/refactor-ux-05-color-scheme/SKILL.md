---
name: refactor-ux-05-color-scheme
description: Choose acornfall's console palette as a specific, persona-justified direction, expressed in tokens, and get it confirmed. Step 5 of the refactor-ux chain.
---

# Pick the colour scheme

## When to use it

Right after step 04, same session, never standalone.

## The playbook

1. **Start from the personas and the goal.** What must this palette signal to one operator who
   reads agent evidence all day, in long sessions, often at night? Name what the accent and the
   neutrals are doing — not "clean and modern".
2. **Respect the system that exists.** The brand is amber (`feat: amber brand system with
   dark-mode mark`) over a neutral ramp. ADR-0016 allows no arbitrary values, no Tailwind palette
   classes, and no primitive reads outside the token file. A palette here is a change in
   `ui/src/styles/tokens.css` plus its registration in `ui/src/styles/globals.css`, and
   `make lint` (check-system) must stay green.
3. **A component library is the mechanism, not the decision.** shadcn's defaults are a starting
   point, not the answer.
4. **Check it in both themes, on real content**: long transcripts, dense tool output, cost and id
   micro-text, dialogs over surfaces.
5. **Write the direction to `docs/ui-workflow/refactor-ux/05-palette.md`** — accent, neutrals, and
   the reason for each — and get the user's explicit reaction before moving on.

## Exit gate

- [ ] the palette is named as a specific direction, with a reason per choice
- [ ] it fits ADR-0016 (tokens only) and holds in both themes
- [ ] the user confirmed it

Then invoke `refactor-ux-06-mock-iterate`.

## Why this matters

A palette picked for being safe reads as generic to the exact person it is meant to please.
