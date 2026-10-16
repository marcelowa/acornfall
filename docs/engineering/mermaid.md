# Diagrams in the transcript

An investigation, not a decision. Written 2026-10-13 for the owner, who reads model output in the
console and sees ` ```mermaid ` as a code block. It answers one question — which library or
libraries should draw that diagram — with numbers from this machine rather than from a datasheet.

## What runs today

`ui/src/components/transcript/render-markdown.ts`: `marked` 18.1.1 parses, `DOMPurify` 3.4.16
sanitises, `highlight.js` colours. Assistant text and tool output are untrusted, raw HTML is
escaped rather than passed through, images are refused (a remote URL is an exfiltration channel),
and links are hardened. `Markdown` (`markdown.tsx`) memoises the HTML and sets it with
`dangerouslySetInnerHTML`. A live reply re-renders on every delta; a finished one does not.

`PURIFY` in that file lists `svg` in `FORBID_TAGS`, so nothing SVG-shaped survives today.

Built bundle on this machine, for scale: `index-*.js` 716.71 kB, gzip 226.91 kB. `mermaid` is not
a dependency.

## What marked does with a Mermaid fence

Nothing. `marked.parse("```mermaid\ngraph TD\n A-->B\n```")` returns
`<pre><code class="language-mermaid">`, and the console shows it as code. That is the reported
symptom, and it is not a formatting bug — no markdown parser draws. Drawing needs a renderer,
and the only renderer that reads Mermaid's own syntax is Mermaid.

## The candidates

| Option | Verdict |
|---|---|
| `marked` + `mermaid` | Keeps the tested renderer; adds one lazy chunk and one component. |
| `streamdown` + `@streamdown/mermaid` | Works and is built for streaming, but replaces the whole markdown layer and its tests. |
| `markdown-it` (+ a Mermaid plugin) | Six new deps, no Mermaid benefit; its Mermaid plugins are stale. |
| `@viz-js/viz` (Graphviz WASM) | 4.99 MB, MIT, offline — but Graphviz reads DOT, which models do not emit. |
| `@terrastruct/d2` (D2 WASM) | 60 MB unpacked, MPL-2.0 — same objection, worse size. |
| `@mermaid-js/mermaid-cli` in the gateway or worker | Needs a headless Chromium per render; the gateway is Go and the worker is bun with no DOM. |
| kroki.io or any hosted renderer | Sends the operator's conversation to a third party. Refused on the same principle as `img`. |

Sizes from the registry: `mermaid` 12.2.0, MIT, 23 deps, 122 MB unpacked (1333 files, most of it
per-diagram chunks). `streamdown` 2.7.0, Apache-2.0, 15 deps; its Mermaid plugin is 489 bytes of
code that initialises Mermaid and hands it to streamdown's own block renderer.

## What Mermaid costs, measured

Mermaid loads as a dynamic import, so the cost lands on the first diagram, not on startup. Its
chunks, gzipped, from the published 12.2.0 tarball:

| Slice | Gzip |
|---|---|
| entry + static closure (19 files) | 183 kB |
| + `flowDiagram` | 22 kB |
| + `sequenceDiagram` | 32 kB |
| + `classDiagram-v2` | 17 kB |
| + `pieDiagram` (pulls katex) | 144 kB |

So a first flowchart costs about 205 kB gzip after the app's own 227 kB. Every later diagram type
is a smaller lazy chunk.

## What Mermaid's output looks like

Rendered in the Chromium this repo already drives (`/usr/bin/chromium`, via `tools/`'
`puppeteer-core`), headless, on a four-node flowchart:

- cold render 473 ms, second render 48 ms;
- 14,575 bytes of SVG, `role="graphics-document document"`, `viewBox="4 4 360 430"`;
- 1 `<style>` element, 29 inline `style=` attributes, 4-6 `<foreignObject>`;
- **node labels are HTML inside `foreignObject`**: `<div xmlns="…xhtml"><span
  class="nodeLabel"><p>Ask</p></span></div>`;
- no network request during render (an icon-based diagram would ask for Iconify packs);
- fresh dependency graph stays empty: nothing is fetched from a CDN.

## The sanitiser is the real problem

Two findings, both from running it:

1. **Our current config deletes the whole diagram.** `svg` is in `FORBID_TAGS`, so
   `DOMPurify.sanitize(svg, PURIFY)` returns `""` — 14,575 bytes in, 0 bytes out.
2. **DOMPurify 3.4.16 deletes Mermaid's labels even when SVG is allowed.** It keeps
   `<foreignObject>` and empties it: 14,575 in, 12,193 out, zero label text. Adding
   `foreignObject`, `div`, `span`, `p` to `ADD_TAGS` does not help; neither does
   `KEEP_CONTENT: true` nor `RETURN_DOM: true`. This is deliberate behaviour, not a
   misconfiguration. Allowing SVG without losing the labels means either not putting the SVG
   through DOMPurify, or rewriting the HTML labels into `<text>` first.

Mermaid's own hardening, on a hostile label (`<img src=x onerror=…>`, `<script>`, a
`click … "javascript:"` handler), with `securityLevel: "strict"`:

| Attack | Result in Mermaid's raw output |
|---|---|
| `<script>` | removed |
| `onerror=` and other `on*` handlers | removed |
| `javascript:` link | removed |
| `<img src=x>` | **kept** — no handler, but a browser still fetches it |
| `<b>` in a label | kept |

So Mermaid's own sanitiser is a real layer, and it is not quite ours: it leaves an image where our
rules refuse one.

## The three options

**A. Keep `marked`, add `mermaid` (recommended).** One dependency, lazy. `render-markdown.ts`
gains a branch in its `code(token)` renderer that marks a Mermaid block instead of a
`<div class="code-block">`; a `Mermaid` component takes the source, renders it, and shows the
result. Sanitising is Mermaid's `securityLevel: "strict"` plus a small string guard over the SVG
(drop `<script`, `<img`, `on*=` attributes and `javascript:`). Details this needs:

- render only when the fence is closed and the entry is not live — the live path re-renders on
  every delta, and half a diagram is not a diagram;
- the source and the SVG live behind `useMemo`/state, one render per (source, theme);
- theme from `tokens.css`: Mermaid's `themeVariables` read the semantic custom properties, and a
  theme flip re-renders;
- the guard and the fence detection are unit-testable in `ui/test/`; the drawing itself belongs
  in `tools/check-ui.mjs`, which already drives Chromium against the built client;
- a Storybook story next to `markdown.stories.tsx`, including a broken diagram and a hostile one.

**B. Sandboxed iframe.** Render into `<iframe sandbox srcdoc>`: no script can run inside, and no
sanitiser question is left open. Costs: `sandbox=""` gives the frame an opaque origin, so the
parent cannot read the diagram's height and must compute it from the SVG's `viewBox`; the tokens,
the fonts and the print path all have to be pushed into the frame.

**C. Swap the markdown layer for `streamdown`.** It is built for streaming text, its Mermaid
plugin is 3 kB over Mermaid itself, it renders and injects the SVG without a second DOMPurify
pass (so labels survive), and it ships a render button and a `.mmd` download. Costs: it replaces
`render-markdown.ts` and `ui/test/render-markdown.test.ts`, brings 15 deps plus Shiki, and its
own class names have to be fitted to our tokens. It earns its place if streaming robustness —
incomplete fences, half a table — is a pain we already feel.

## Recommendation

A. It is the smallest change that satisfies the rule in `docs/engineering/standards.md` ("the
smallest change that satisfies the rule"), it keeps the sanitiser and its tests ours, and the
only genuinely new thing is Mermaid. Take C only if we decide the markdown layer itself should
be streaming-aware; that is a wider change than this one.

Open questions for the owner:

1. Render every diagram, or a "Render diagram" button per block, the way `Raw`/`Formatted`
   already works? Streaming output argues for the button: a diagram that paints mid-sentence
   moves the text the reader is reading.
2. Which diagram types do we accept? Flowchart and sequence cover what models emit; the rest can
   stay code.
3. A hard size limit on the source (Mermaid has no such guard) and a wall-clock limit on the
   render, or let a heavy diagram block the pane.

## Reproducing the numbers

The probe was throwaway: `/tmp/pk` holds the unpacked `mermaid` 12.2.0 tarball, `/tmp/poc` a page
that serves its `dist/`, a Chromium run through `tools/node_modules/puppeteer-core`, and the
sanitiser checks above. Nothing in the repository was changed except this file.
