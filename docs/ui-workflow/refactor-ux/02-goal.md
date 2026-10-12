# 02 — Confirm the goal

Status: **confirmed by the owner, 2026-08-29.** Approved as written, with the foundation clause.

## The goal statement

Acornfall is a local-first agent console for one technical operator — the owner. A Go gateway
supervises a bun worker and a microVM sandbox per workspace; `ui/` is the only face of it that
speaks. Working well means the owner can:

- find the right conversation in a rail of dozens and resume it;
- read a long, tool-heavy turn without losing their place;
- intervene mid-run with no doubt about what the intervention does;
- change a setting once and know it stuck;
- see what the model saw and what the run cost.

Success today: the console stays open all day and the owner never drops to a terminal to check on
it. Failure today: they open the terminal, or they open three wrong conversations to find the
right one.

## The foundation clause

The operator is one person now. The interface must later carry a multi-user platform — more
personas, more themes, hosted context — without a rewrite. This pass owes that foundation:
tokens, journeys, a written direction, and components that take what they need as props. It does
not owe multi-user features, and it must not invent personas that do not exist yet.

## What "working well" does not mean here

- Not more capabilities. The pass runs against what already works.
- Not a new client. `gateway/web` is the old client and stays the behavioural reference
  (ADR-0016).

## Confirmation

Approved in the owner's words: "all approved let's go".
