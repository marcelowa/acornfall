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
| Steps | a ` ```steps ` fence, one `state: text` per line | a dot per step — `done`, `doing` (ringed), `blocked`, `todo` — with the model's words beside it |
| Chart | a ` ```chart ` fence, one `name: number` per line | a bar per line, scaled to the longest, with its number beside it |

The two prose forms are renderer hooks in `render-markdown.ts` and `markdown.css`: a `blockquote`
hook, a `checkbox` hook, and a `list` hook that wraps a list whose every item is a task. A `steps`
fence is drawn by that file's `code` hook, because rows of text are still HTML.

A chart and a Mermaid diagram cannot be HTML strings — one is a component, the other has to run and
be inserted as a node — so both are split out of the reply before the parse (`markdown-blocks.ts`)
and drawn by their own component (`chart.tsx`, `mermaid-diagram.tsx`). The chart needs no guard:
the renderer builds its bars and labels, so the model's words are React text and there is no second
sanitiser in the path.

Four limits keep the forms honest, all tested:

- The alert marker has to be the quote's first line and nothing else on it. `> [!WARNING] careful`
  is a quote with a marker in it, not a callout, which is GitHub's rule too; the reader sees the
  words the model wrote rather than a judgement the console made.
- The box is a `<span role="img" aria-label="Done">`, not an `<input>`. DOMPurify refuses `input`,
  so before this change a task list lost its boxes entirely and showed bare bullets. A form that
  is a control in the source is a picture here.
- A step that names no known state is a `todo` dot and keeps its whole line, and an empty `steps`
  fence stays a code block. Nothing the model wrote is dropped, and the console never guesses.
- A chart fence has to read whole: a line that is not `name: number`, a value that is not a count,
  and a fence with more than 24 lines all stay code blocks. A chart that drops a line is a chart
  that lies, and a fence with a hundred bars is a table.

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

A renderer hook in `render-markdown.ts` — or, when the form is not HTML, a kind in
`markdown-blocks.ts` and a component of its own — styles beside it, unit tests in `ui/test/`, a
story in Storybook, and, when it is the stylesheet that makes the form readable, a check in
`tools/check-ui.mjs`, the only tier that sees painted pixels.

Not built, and what each would cost:

- **A fold inside a reply.** It is a control, not a picture, so it is out by the rule above.
- **`matrix` of ok / warn / fail cells, `stats` tiles, `json` and `tree` folds, a sparkline or a
  line chart.** All the same shape of work as the chart, none of them asked for yet.

## Evidence

- `ui/test/render-markdown.test.ts` — the marker rules, the boxes, the count, the plan's dots, and
  the sanitiser on a callout body and on a step.
- `ui/test/markdown-blocks.test.ts` and `ui/test/chart-source.test.ts` — where the split happens,
  and which fence is a chart at all.
- `Conversation/Markdown/CalloutsAndChecklists`, `Conversation/Markdown/Steps`,
  `Conversation/Markdown/WithChart` and `Conversation/Chart` — the stories: all five labels, a plan
  with its count, a plan with a blocked step, a drawn chart and a refused one.
- `tools/check-ui.mjs` — "a callout is drawn and tinted", "a checklist is drawn, boxed and
  counted", "a plan is drawn down its dots, with the one in hand ringed", "a chart draws a bar per
  number, scaled to the longest", and the dev provider sentence that answers a request for the
  visual forms.
