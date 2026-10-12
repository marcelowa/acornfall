---
name: refactor-ux-04-icp-panel-journeys
description: Run sub-agents as the owner's personas against the current console and the drafted journeys, and bring their raw feedback to the user. A gate. Step 4 of the refactor-ux chain.
---

# Panel — first pass, on the journeys

## When to use it

Right after step 03, same session, never standalone.

## The playbook

1. **Load personas from `icp.md` at the repo root.** If it is missing, draft it with the user now
   and save it — every panel in this chain reads that file, so the personas stay identical across
   passes.
   - acornfall's honest set is one real person in three modes: **OWNER-OPERATOR**, **DELEGATOR**,
     **TINKERER** (source: `docs/ui-workflow/02-need-report.md`).
   - Do not invent multi-user personas — a teammate, a buyer, a hosted tenant. They do not exist
     yet, and judged against them the panel returns false confidence. Say that in `icp.md`.
2. **Persona block format:**

   ```md
   ### Persona: <name>
   - role: <who they are, and their relation to the console>
   - goal: <what success looks like for them>
   - triggers churn: <what makes them give up or leave>
   - judges "good" by: <the feeling or metric they really use>
   - reviews: journeys, look
   - feedback format: keep / cut / confused-by / would I keep using this — one line each
   ```

3. **Spawn one sub-agent per persona** (the delegation tool), handing it the persona block
   verbatim, the journeys from step 03, and the current console for contrast. Tell it not to
   soften criticism to be helpful.
4. **Bring the feedback to the user in full, then get their reaction** — agreement, pushback, or a
   revised journey. Do not paraphrase it down to a summary.
5. **The panel costs runs; reacting costs the user's time.** Both are the price of this gate, and
   the gate needs their reaction, not the model's self-review.

## Exit gate

- [ ] `icp.md` exists with the three modes, and says why no multi-user persona is in it
- [ ] every persona gave concrete, un-softened feedback on the journeys
- [ ] the user reacted to that feedback

Then invoke `refactor-ux-05-color-scheme`.

## Why this matters

A journey that reads well to the person who wrote it can still fail the person who will use it.
