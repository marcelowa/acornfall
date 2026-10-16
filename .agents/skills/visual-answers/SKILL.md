---
name: visual-answers
description: Shape an answer as a picture before a paragraph — callouts, checklists, tables, diffs, diagrams — when the user reads it in the acornfall console. Use when wording a reply, a report, or a plan for the owner.
---

# Visual answers

The owner reads your reply in the console. Reading a wall of text is slow. Say the thing in the
shape that fits, then the words that are left.

This is a picture, not a control. The console draws; the reader only reads.

## The forms, and what each is for

| Write | For |
|---|---|
| `> [!WARNING]` on the first line of a quote | a risk, a limit, a decision the reader must stop on |
| `> [!NOTE]` / `[!TIP]` / `[!IMPORTANT]` / `[!CAUTION]` | a fact, a shortcut, something unmissable, something not to do |
| `- [x]` / `- [ ]` | a plan and what is left — the console shows `3/5` above it |
| a ` ```steps ` fence | a plan's state, one line per step: `done: read it`, `doing: build it`, `blocked: on the key`, `todo: run it` |
| a ` ```chart ` fence | numbers to compare: one `name: number` per line, and the console draws a bar per line — the longest is the longest |
| a ` ```matrix ` fence | where the same checks landed on several targets: column names on the first line, then `label \| pass \| fail`, and the cell's word sets its colour |
| a ` ```stats ` fence | the facts of an answer — a commit, a size, a count — one `name: value` per line, drawn as tiles |
| a ` ```tree ` fence | where files live: one path per line, and the console writes each shared directory once |
| a ` ```spark ` fence | a shape: three to sixty numbers in a line, and the console draws the line with the first and last value at its ends |
| a GFM table | numbers and comparisons, so they line up down a column |
| ` ```diff ` | what changed; adds and removes are coloured already |
| ` ```mermaid ` | a flow, a sequence, a state machine |
| `##` and `>` | structure a long reply is read by |

## Rules

- Answer in the first line. Detail after it.
- One diagram at most in an answer. Two pictures are one too many.
- Draw it only when it replaces five or more lines of prose. A callout around two words is noise.
- Keep a marker honest: `[!WARNING]` for a real risk, `[!NOTE]` for a fact. Do not decorate.
- One state per step, and the four states are `done`, `doing`, `blocked`, `todo`. A step that is
  stuck says `blocked`, not `todo` — the dot is the only thing a reader looks at.
- A chart is for numbers a reader compares: counts of things, not money or duration. Two bars, or
  six; twenty-four is the last the console draws. A number the reader only needs once is a
  sentence.
- A matrix is for the same two or three checks on two or three targets, not for a table of prose.
  Its cells are `pass` (or `ok`, `done`), `skip` (or `warn`, `flaky`), `fail` (or `error`), and `-`
  when there is nothing to say — a grid that does not line up is shown as code instead.
- A `stats` fence is not a table: a table compares rows, tiles are the facts an answer would
  otherwise bury in a sentence. Four or five of them, all of the same kind.
- A spark is for a shape — a week of spend, a run of timings — not for a comparison: three to sixty
  numbers, and the two at the ends are the fact the shape is about. For two numbers, write the
  sentence.
- The marker must be alone on the first line, or the console draws a plain quote.
- Numbers go in a table or a list, not in a sentence.
- A state earns its mark: a checklist tick means done, not hoping.
- When a form says the same thing as a clear sentence, keep the sentence.
