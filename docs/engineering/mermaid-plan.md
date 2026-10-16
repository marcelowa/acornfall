# Mermaid rendering: the plan

The proposal that follows the investigation in `mermaid.md` and the parser comparison in
`markdown-parsers.md`. It keeps `marked`, adds one dependency, and changes five files in `ui/`.
Nothing crosses the wire differently, and no server code changes: the console already parses
markdown in the browser, so the renderer lives there too.

## Implemented — 2026-10-13

Shipped as proposed, with four things the writing of it turned up. `make lint`, `make test` and
`make ui` (103 checks, one of them new) pass.

**The four findings.**

1. **The tokens are oklch, and Mermaid cannot read them.** Handed `oklch(…)`, `mermaid.render`
   throws "Unsupported color format: …" and nothing draws — Mermaid mixes its own shades (pie
   slices, git lanes) with colour maths that knows hex and rgb. Every colour value now goes through
   a one-pixel canvas, which is the browser's own answer to "what colour is this" and resolves
   `color-mix()` expressions too. `mermaid-runtime.ts`, `colour()`.
2. **Mermaid's SVG is not always well-formed XML.** When a label holds a void tag (`<img>`, `<br>`)
   Mermaid writes the label's HTML into the SVG string as it found it, so an XML parser refuses the
   whole drawing — and a drawing is exactly what that label came from. The guard parses as HTML,
   and refuses when the HTML parser closes the `<svg>` early (the reserved-tag breakout), because a
   fragment is not the drawing the model wrote. `svg-guard.ts`.
3. **Your own words are shown as typed.** A user message is `whitespace-pre-wrap` text by design, so
a fence sent by the operator is never drawn, and the existing suite's first attempt at a check
   had nothing to assert. The browser check now seeds a turn instead, which needs a reply with a
   fence in it: the default dev provider answers a request that mentions "diagram" with a diagram
   (`worker/src/devprovider.ts`), which is also the fastest way to see one by hand.
4. **The refusal shows the source**, which means the component renders the markdown stylesheet's
   code-block markup; it imports `markdown.css` for that and its own `mermaid.css` for the rest.

**What it measures in the shipped bundle.** The main chunk is 737.5 kB (233.5 kB gzipped) and no
longer contains any Mermaid code — checked by grep for Mermaid's own strings, which appear only in
our config object. The first diagram pulls 19 more files, 150 kB gzipped; a first flowchart 172 kB
across 26 (less than the 205 kB estimated from the published tarball, because the bundler shares
chunks with the app).

**What is not done:** `remend` for streaming repairs (a separate change, see below), and the
"Render diagram" button — the drawing appears when the turn commits, as proposed.

## The shape

`mermaid` 12.2.0, imported dynamically so the main bundle keeps its size, and rendered once when a
reply has finished. A fence that is still being written stays a code block; so does a fence that
does not render, with one line saying why.

Why not DOMPurify for the drawing: it empties `foreignObject`, and Mermaid puts node labels there,
so a sanitiser pass would delete every label and leave empty boxes (`mermaid.md` has the numbers).
Mermaid's `securityLevel: "strict"` is the first layer — it removes `<script>`, `on*` handlers and
`javascript:` links itself — and a small tree walk over the result is the second: forbid a short
tag list and every event handler, and allow the rest. That walk is pure, fixture-testable, and
reads in a review, which is what matters in the one place where a hand-written filter sits in the
security path.

## The files

| File | Change |
|---|---|
| `ui/package.json` | `"mermaid": "^12.2.0"` |
| `ui/src/components/transcript/mermaid-source.ts` | new — split a reply into text and diagram segments |
| `ui/src/lib/svg-guard.ts` | new — the tree walk over Mermaid's SVG |
| `ui/src/components/transcript/mermaid-runtime.ts` | new — one Mermaid instance, configured from the tokens |
| `ui/src/components/transcript/mermaid-diagram.tsx` | new — the component: render, fail, keep the source |
| `ui/src/components/transcript/markdown.tsx` | render segments instead of one HTML string |
| `ui/src/components/transcript/markdown.css` | a `.mermaid-block` rule and the failure line |
| `ui/src/components/transcript/assistant-message.tsx` | pass `streaming={entry.live === true}` |
| `ui/test/mermaid-source.test.ts`, `ui/test/svg-guard.test.ts` | new unit tests |
| `ui/src/components/transcript/mermaid-diagram.stories.tsx` | new stories |
| `tools/check-ui.mjs` | one browser check against a scripted reply |

## The pieces

**Splitting** (`mermaid-source.ts`). A reply is a sequence of segments, so the parser stays
untouched and the diagram is a React component rather than an HTML string:

```ts
export type Segment = { kind: "text"; text: string } | { kind: "mermaid"; source: string };

/**
 * A reply split at its closed ```mermaid fences. A fence that is still open is not a diagram
 * yet: it is text, which is what a streaming reply needs. `%%{init}%%` lines are dropped: they
 * carry Mermaid configuration from the model, and the console configures Mermaid itself.
 */
export function splitMermaid(source: string): Segment[];
```

**The guard** (`svg-guard.ts`):

```ts
const FORBIDDEN_TAGS = new Set(["script", "img", "image", "iframe", "object", "embed", "form", "input", "button", "animate", "set", "audio", "video"]);

/** Mermaid's own strict mode has run. This removes what it leaves: elements that fetch, elements
 * that submit, and every handler — then hands back a node the component can insert. */
export function guardSvg(markup: string): SVGSVGElement | null;
```

Rules: parse into a `<template>`; walk it; drop forbidden elements; drop `on*` attributes; drop
`href`/`xlink:href` unless it starts with `#`; keep `foreignObject` and its labels, keep
`<style>`, keep `<text>`.

**The runtime** (`mermaid-runtime.ts`): one `initialize` per page, `theme: "base"`, the
`themeVariables` read once from `getComputedStyle(document.documentElement)` — `--primary`,
`--foreground`, `--muted`, `--border`, `--card` — and `securityLevel: "strict"`,
`startOnLoad: false`, `suppressErrorRendering: true`. A `themeKey()` helper watches
`document.documentElement`'s class with a `MutationObserver`; the console already toggles `.dark`
there, so a theme flip re-renders the diagram and nothing else has to know.

**The component** (`mermaid-diagram.tsx`): state machine `idle → rendering → ready | failed`; a
dynamic import inside the effect; on failure it renders the source as a code block plus one line
in the console's own voice — "Diagram not rendered: <Mermaid's message>" — because a refusal says
what happened. Caps: source over 8 kB, or a fence for a diagram type Mermaid does not know, keeps
the code block. On success it inserts the guarded SVG with `replaceChildren` into a
`.mermaid-block` div, and sets `width="100%"` so a wide diagram shrinks to the pane and scrolls
inside itself, the way a code block does.

**`markdown.tsx`**: the container keeps its class and `dir`, each text segment becomes a
`.markdown-part` div with `display: contents` (so every existing `.markdown > …` rule keeps
working) and its sanitised HTML, and each diagram becomes a `<MermaidDiagram>`.

```tsx
export function Markdown({ children, streaming = false, className }: MarkdownProps) {
	const segments = useMemo(
		() => (streaming ? [{ kind: "text" as const, text: children }] : splitMermaid(children)),
		[children, streaming],
	);
	// …
}
```

**`assistant-message.tsx`** passes `streaming` from the entry it already has. A reply draws its
diagrams when the turn commits, which is also the moment it gains its controls — one rule, not
two.

## What it costs

- First diagram: about 205 kB gzip (183 kB Mermaid base + 22 kB flowchart), loaded on demand;
  later diagram types are smaller chunks. The main chunk stays where `make ui-build` prints it
  today (227 kB gzip) — that is a check, not a hope.
- 473 ms cold render, 48 ms warm, measured in this repo's Chromium.
- 23 new packages under `mermaid`, which is the largest dependency this project has added.

## What it does not do

- No network: verified for flowcharts; a diagram type that wants Iconify icon packs is left off.
- No render cancellation: Mermaid's API has none. The size cap is the guard, and this is worth
  saying out loud rather than pretending a timeout exists.
- No server rendering: the gateway stays markdown-free.

## Checks

1. `ui/test/mermaid-source.test.ts` — closed fences split, an open fence stays text, `~~~` fences,
   a longer fence around a shorter one, the init-directive rule, the size cap.
2. `ui/test/svg-guard.test.ts` — a hand-written fixture with a script tag, an `onerror`, a
   `javascript:` link, a nested `<img>` inside a label and a real `foreignObject` label: labels
   and text survive, everything else is gone. Fixtures, because jsdom cannot lay out an SVG.
3. `tools/check-ui.mjs` — one check: the scripted dev provider answers "draw the flow" with a
   mermaid fence (`ACORNFALL_DEV_SCRIPT`, the mechanism `features.md` describes), and the suite
   asserts an `<svg>` with non-empty label text is in the transcript, and that no off-origin
   request happened while it drew. That is the only place that proves the lazy chunk loads
   through the real bundle.
4. Storybook — `mermaid-diagram.stories.tsx`: a flowchart, a sequence diagram, a broken diagram,
   a hostile one, a 200 kB-wide one, and one in the dark theme.
5. `make ui-build`, `make lint`, `make test`, `make ui`. Then the `/deslop` pass the standards ask
   for, before the diff is called done.

## Streamdown, honestly

The owner's question was whether adopting `streamdown` replaces this plan. It does not replace the Mermaid
work; it replaces the markdown layer and throws Mermaid in. Facts read out of its own `dist` and
`package.json` (2.7.0, Apache-2.0):

- **Mermaid is the same Mermaid.** `@streamdown/mermaid` is 489 bytes: it calls
  `mermaid.initialize({ securityLevel: "strict", theme: "default", fontFamily: "monospace" })`
  and hands the source to streamdown's block renderer, which inserts the SVG with
  `dangerouslySetInnerHTML`. No second guard — this plan's tree walk is one layer streamdown does
  not have. The 205 kB gzip chunk is identical either way.
- **Its Mermaid block is a button, not automatic** ("as code blocks with a button to render"),
  with zoom, pan and a `.mmd` download already written. That is the answer to open question 1 if we
  adopt it, and about two days of work we would otherwise write ourselves.
- **Sanitising moves rather than disappears.** It runs `rehype-raw` (raw HTML is parsed) then
  `rehype-sanitize` with a schema built on `defaultSchema`, then `rehype-harden` for links.
  `defaultSchema` allows `img`, so this console's no-images rule has to be re-expressed in its
  config; today raw HTML is escaped outright, which is a smaller surface than parsing then cleaning.
- **Styling is Tailwind classes from its own bundle**, so `globals.css` gains
  `@source "../node_modules/streamdown/dist/*.js"`, and the 152-line `markdown.css` is re-pointed at
  its `data-streamdown` attributes or dropped. A class our theme does not define fails silently.
- **Cost**: 15 direct dependencies plus the unified stack, `shiki` for code blocks (or a custom
  `components.code` to keep `highlight.js`), and `render-markdown.ts` (83 lines) plus its eight
  security tests rewritten against streamdown's config.

So: same picture, minus a filter, plus a button, zoom and download; and a rewrite of the wheel we
already own instead of 120 new lines. It is a defensible trade — it is not a smaller one.

### The middle path: take the streaming half only

Most of streamdown's day-to-day value is `remend` (1.4.0, Apache-2.0, 28 kB unpacked, zero
dependencies), which repairs an unterminated reply before it is parsed. It runs in front of
`marked` in two lines. Run against this console's own pipeline just now:

| Streaming text | Today | With `remend` |
|---|---|---|
| `Here is a **bold` | `<p>Here is a **bold</p>` | `<p>Here is a <strong>bold</strong></p>` |
| `` `inline code `` | literal backtick | `<code>inline code</code>` |
| `~~struck` | literal tildes | `<del>struck</del>` |
| `a [half link](http` | literal brackets | the link text, no href (`linkMode: "text-only"`) |
| `text <custom` | `text &lt;custom` | `text` |
| `| a | b |\n| - |` | literal text | unchanged — tables are not repaired |
| ```` ```ts ```` unclosed | a code block already | unchanged |

Settings: `linkMode: "text-only"` (the default invents a `streamdown:incomplete-link` href) and
`images: false` (the default inserts a `streamdown:incomplete-image` placeholder, which matters here
because this console refuses images). That is 1.4 kB for the visible half of streamdown's
streaming story, on top of the five files above.

## Why there is no plugin to adopt

Checked before writing the plan, because it would have been the smaller change:

- **The markedjs organisation has no Mermaid plugin.** Its repositories are `marked-base-url`,
  `marked-bidi`, `marked-block-table`, `marked-custom-heading-id`, `marked-gfm-heading-id`,
  `marked-highlight`, `marked-mangle`, `marked-smartypants`, `marked-xhtml` and the test tooling.
  The nearest thing is `marked-highlight` (369,743 downloads a week) — and it works only because
  highlighting is a string: it wraps code in `<span class="hljs-…">` at parse time. Drawing a
  diagram needs the Mermaid runtime and a live DOM, and produces an SVG that has to be rendered by
  React. A parse-time hook can only leave a placeholder behind.
- **The one package that exists is unusable here.** `marked-mermaid` 0.1.0 (published 2023-03-16,
  58 downloads a week, dependencies `lodash.memoize` and `mermaid@^9`) overrides the same `code`
  block hook this plan uses. Its source has `const isBrowser = false` hardcoded, so it always takes
  its server path: it emits `<pre class="mermaid">source</pre>` followed by an inline
  `<script type="module">` that imports Mermaid 9 from `cdn.jsdelivr.net` and runs `startOnLoad`.
  This console escapes raw HTML, so that script would be shown as text; if it ever ran, it would
  fetch a CDN inside the transcript, which is the one thing these rules refuse.

So the integration *is* the marked hook, and it is already in `render-markdown.ts`. What no plugin
can carry is the rest: the guard (DOMPurify deletes the labels), the streaming rule (an open fence
stays a code block), the theme mapping, the size cap, and the render call itself.

## What I need from you

1. **Auto-render after the turn commits, or a "Render diagram" button per block?** I propose
   auto. Reading a reply should not need clicks, and the commit moment is already the console's
   line between arriving and settled. The button is the honest choice if a heavy diagram should
   never paint by itself.
2. **The 205 kB gzip on first diagram.** Accept it, or re-open the sandboxed-iframe variant in
   `mermaid.md` (isolation instead of a guard, more plumbing), or the `streamdown` swap (different
   markdown layer, `markdown-parsers.md`).
3. **`streamdown` or `remend`?** Adopt the whole layer for the button, the zoom and the download,
   and rewrite `render-markdown.ts` and its tests; or keep `marked` and add `remend` to fix what a
   streaming reply actually gets wrong today. I propose the second, and the streaming repair is a
   separately reviewable change either way.
