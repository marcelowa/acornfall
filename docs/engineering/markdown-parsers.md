# Which markdown parser

A comparison run on 2026-10-13, next to `mermaid.md`. It answers "is `marked` the best option, and
what else is there" with the CommonMark and GFM spec suites, wire sizes and timing from this
machine rather than from a feature table.

## How it was measured

A throwaway page (`/tmp/cmp`, nothing in the repository) loaded each parser from `esm.sh` with
`?bundle`, so the whole module graph is one file and its compressed wire size is the cost a user
pays. Each parser then rendered every example of the two official suites and the HTML was compared
to the expected HTML:

- CommonMark 0.31.2 — 652 examples, `spec.commonmark.org/0.31.2/spec.json`;
- GFM 0.29 — 672 examples, `github/cmark-gfm/test/spec.txt`, tabs restored.

Two scores. **Exact** is byte-identical output, which only the reference implementation reaches.
**Shape** is after normalising void-element spelling (`<br />` → `<br>`) and trailing whitespace —
the differences no reader can see. A parser is configured the way this console configures it
(`breaks: true`, GFM tables on) unless labelled "breaks off".

## The numbers

| Parser | CommonMark shape | GFM shape | Wire (compressed) | Direct deps | Raw HTML by default |
|---|---|---|---|---|---|
| `marked` 18.1.1 | 500/652 | 500/672 | 17.5 kB | 0 | passes through |
| `markdown-it` 15.0.2 | 513/652 | 508/672 | 48.2 kB | 6 | escaped |
| micromark → mdast → hast → html | 527/652 | 533/672 | 60 kB | 6 packages, ~65 declared | refused by the last step |
| `commonmark` 0.31.2 (the reference) | **652/652** | 641/672 | 62 kB | 3, one of them `entities` (46.6 kB of the 62) | passes through |
| `showdown` 2.1.0 | 251/652 | 259/672 | 32 kB | 1 (`commander`, the CLI) | passes through |
| `snarkdown` 2.0.0 | 13/652 | 14/672 | 1.8 kB | 0 | passes through |

Timing, 652 documents in one pass, three passes averaged (the concatenated corpus is 15.5 kB):
`snarkdown` 2 ms, `commonmark` 7 ms, `marked` 11 ms, `markdown-it` 12 ms, `showdown` 39 ms,
micromark pipeline 212 ms. Parse speed is not the deciding factor at chat scale.

The `breaks: true` convention this console uses costs real fidelity: with breaks off, `marked`
reaches 498/652 exact and 555 shape, `markdown-it` 519 exact and 577 shape. That is the price of
the chat convention (single newline = line break), paid deliberately and paid by both.

## What the numbers say

- **`commonmark` is the only one that is actually correct**, and it is the only one with no GFM
  tables. Its HTML is the spec's, which matters if output is ever compared or stored. It carries
  `entities` (46.6 kB compressed) for entity handling.
- **`markdown-it` is the best balance of the three real options.** It is closer to the spec than
  `marked` at the same speed, it has a plugin API, and it escapes raw HTML by default, which is a
  second layer behind DOMPurify. It costs 2.8× the bytes and 6 direct deps.
- **`marked` is the cheapest and the smallest**, is the fastest of the ones that count, has zero
  dependencies, and is what is installed and tested here. It is not the most correct, and raw HTML
  passes through by default — this repository already hooks `html()` to escape it.
- **`showdown` and `snarkdown` are out.** Neither tracks CommonMark.
- **The micromark pipeline is what `react-markdown` and `streamdown` sit on**: six packages, ~60 kB,
  about 19× slower, and mid-table on fidelity. Its advantage is shape, not score: it produces React
  elements and a tree (`mdast`/`hast`) that a sanitiser, a plugin or a custom node can work on,
  which is the only route that avoids `dangerouslySetInnerHTML` entirely. Its wire size above is
  measured, not guessed: `mdast-util-from-markdown` 19.9 kB, `hast-util-to-html` 13.3,
  `mdast-util-gfm` 9.5, `micromark-extension-gfm` 8.7, `mdast-util-to-hast` 6.6, plus stubs.
- **Not measured, worth naming:** `markdown-wasm` (Rust CommonMark in wasm, 0 deps, 165 kB) and
  `@mdx-js/mdx` (compile-time, 25 deps — wrong tool for text that arrives at runtime).

## Recommendation

Keep `marked`. The gap to `markdown-it` is about 30 kB compressed and 6 dependencies for a
fidelity difference no reader will notice; the console's fidelity problem is the missing diagram
renderer, not the parser. Swap only if the owner wants the safer default (raw HTML escaped by the
parser itself) and a plugin API, and then swap only `marked` → `markdown-it`, keeping DOMPurify and
`highlight.js` where they are. The renderer hooks it needs are the same shape: one `code` rule for
the ` ```mermaid ` fence.

Not recommended: the unified/micromark route, unless the goal changes to React-element rendering
(`react-markdown` + `remark-gfm` + `rehype-sanitize`), which is a rewrite of `render-markdown.ts`
and its tests for 3× the bytes and 19× the parse time.
