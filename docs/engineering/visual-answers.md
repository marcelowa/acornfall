# Visual answers

What a reply can look like beyond prose, what each form is for, and where the agent is told about
it. Written 2026-10-16, after the owner asked for replies that show an idea before they explain
it.

## The rule

A reply is a picture of an answer, not an application. Nothing inside one is a control: no
sorting, no zoom, no paging, no toggling, no editing, and nothing is clickable. A checklist is a
picture of a plan, not a box you tick. What the reader does with the console stays the console's
own (a pane folds, a pane has a raw/formatted toggle, a pane copies).

Two more rules, both already true of the renderer:

- Untrusted text stays untrusted. Everything below goes through the same `marked` → DOMPurify
  path as a paragraph, so a form adds no new way to put markup on the screen.
- A form earns its place when it replaces five or more lines of prose. A callout around two words
  is decoration.

## What ships

| Form | The model writes | The console draws |
|---|---|---|
| Callout | `> [!WARNING]` on the quote's first line | a tinted block with an uppercase label: `Note`, `Tip`, `Important`, `Warning`, `Caution` |
| Checklist | `- [x] done` / `- [ ] waiting` | a box per item, and the count (`1/2`) above the list |

Both live in `ui/src/components/transcript/render-markdown.ts` (a `blockquote` hook and a
`checkbox` hook plus a `list` hook that wraps a list whose every item is a task) and
`markdown.css` (the tints and the boxes).

Two limits the hooks keep, both tested:

- The marker has to be the quote's first line and nothing else on it. `> [!WARNING] careful` is a
  quote with a marker in it, not a callout, which is GitHub's rule too; the reader sees the words
  the model wrote rather than a judgement the console made.
- The box is a `<span role="img" aria-label="Done">`, not an `<input>`. DOMPurify refuses `input`,
  so before this change a task list lost its boxes entirely and showed bare bullets. A form that
  is a control in the source is a picture here.

## The rest of the vocabulary

These already render; the skill below is what makes the agent reach for them.

| Form | Syntax | For |
|---|---|---|
| Table | GFM table | numbers and comparisons a reader compares down a column |
| Diagram | ` ```mermaid ` | a flow, a sequence, a state machine — drawn once the turn commits |
| Diff | ` ```diff ` | what changed, coloured by highlight.js already |
| Code | ` ```lang ` | code, with its language badge |
| Heading and quote | `##`, `>` | the structure a long reply is read by |

## Where the agent is told

1. `PREAMBLE` in `worker/src/main.ts` — one line naming the shapes, because it reaches every
   conversation in every workspace.
2. `.agents/skills/visual-answers/SKILL.md` — when a form earns its place, and when plain prose is
   the better answer. A skill is read on demand, so it can be tuned without shipping a release.

## What a new form costs

A renderer hook in `render-markdown.ts`, styles in `markdown.css`, unit tests in
`ui/test/render-markdown.test.ts`, a story in `markdown.stories.tsx`, and — when it is the
stylesheet that makes the form readable — a check in `tools/check-ui.mjs`, which is the only tier
that sees painted pixels. No component and no SVG guard is needed while a form is HTML.

Not built, and what each would cost:

- **A fold inside a reply.** It is a control, not a picture, so it is out by the rule above.
- **`chart` from numbers (bars, a line, a sparkline).** ~1 kB of own SVG plus `lib/svg-guard.ts`
  would carry it, against mermaid's `pie`, which is 144 kB gzip because it pulls katex.
- **`steps` for a plan's state (done / doing / blocked).** The callout and the checklist count
  carry most of it today; this adds a new renderer for the rest.
- **`matrix` of ok / warn / fail cells, `stats` tiles, `json` and `tree` folds.** All the same
  shape of work, none of them asked for yet.

## Evidence

- `ui/test/render-markdown.test.ts` — the marker rules, the boxes, the count, the sanitiser on a
  callout body.
- `Conversation/Markdown/CalloutsAndChecklists` — the Storybook story, all five labels and a plan.
- `tools/check-ui.mjs` — "a callout is drawn and tinted", "a checklist is drawn, boxed and
  counted", and the dev provider sentence that answers a request for the visual forms.
