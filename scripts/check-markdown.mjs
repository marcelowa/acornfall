// Unit tests for the Markdown renderer, most importantly its escaping: assistant
// text and tool output are untrusted, and a renderer that emits model-supplied
// HTML is an injection hole with a friendly name.
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = await readFile(join(here, "..", "gateway", "web", "markdown.js"), "utf8");

// No imports in the module, so it can be evaluated directly after dropping the
// export keywords. Avoids adding a package.json to a directory Go embeds.
const module = new Function(`${source.replace(/^export /gm, "")}
	return { renderMarkdown, stripAnsi, escapeHtml };`)();
const { renderMarkdown, stripAnsi } = module;

const failures = [];
const check = (label, actual, expected) => {
	if (actual !== expected) {
		failures.push(`${label}\n    expected ${JSON.stringify(expected)}\n    actual   ${JSON.stringify(actual)}`);
	}
};
const includes = (label, haystack, needle) => {
	if (!haystack.includes(needle)) failures.push(`${label}\n    ${JSON.stringify(needle)} not in ${JSON.stringify(haystack)}`);
};

// --- escaping is the security boundary ------------------------------------
const script = renderMarkdown("Look: <script>alert('x')</script> and <img src=x onerror=alert(1)>");
check("no raw script tag survives", script.includes("<script"), false);
check("no raw img tag survives", script.includes("<img"), false);
includes("the text is still shown", script, "&lt;script&gt;");

const jsLink = renderMarkdown("[click me](javascript:alert(1))");
check("a javascript: link is not turned into an anchor", jsLink.includes("<a"), false);
includes("the label is kept", jsLink, "click me");

const dataLink = renderMarkdown("[x](data:text/html;base64,PHNjcmlwdD4=)");
check("a data: link is rejected", dataLink.includes("<a"), false);

const goodLink = renderMarkdown("[docs](https://example.com/a?b=1)");
includes("an https link is rendered", goodLink, 'href="https://example.com/a?b=1"');
includes("links open away from the app", goodLink, 'rel="noreferrer"');

const quoted = renderMarkdown('[x](https://example.com "a title")');
includes("an optional title does not break the link", quoted, 'href="https://example.com"');

// Attribute injection through a URL.
const tricky = renderMarkdown('[x](https://example.com/"onmouseover=alert(1))');
check("quotes in a URL cannot escape the attribute", tricky.includes("onmouseover=alert(1)"), false);

// --- blocks ---------------------------------------------------------------
includes("headings", renderMarkdown("## Title"), "<h2>Title</h2>");
includes("bold", renderMarkdown("a **b** c"), "<strong>b</strong>");
includes("italic", renderMarkdown("a *b* c"), "<em>b</em>");
includes("strikethrough", renderMarkdown("a ~~b~~ c"), "<del>b</del>");
includes("rules", renderMarkdown("---"), "<hr />");
includes("blockquote", renderMarkdown("> quoted"), "<blockquote>");
includes("a quote keeps inline formatting", renderMarkdown("> a **b**"), "<strong>b</strong>");
includes("a quote inside a paragraph stays text", renderMarkdown("a > b"), "<p>a &gt; b</p>");
includes("ordered lists", renderMarkdown("1. one\n2. two"), "<ol>");
includes("unordered lists", renderMarkdown("- one\n- two"), "<ul>");
check("a list keeps both items", (renderMarkdown("- one\n- two").match(/<li>/g) ?? []).length, 2);
includes("nested lists", renderMarkdown("- one\n  - nested"), "<ul><li>one<ul><li>nested</li></ul></li></ul>");

const fence = renderMarkdown("```ts\nconst x = **not bold**;\n```");
includes("fenced code renders as code", fence, '<pre class="code" data-lang="ts"><code>');
includes("code keeps its language", fence, 'data-lang="ts"');
check("formatting inside a fence is untouched", fence.includes("<strong>"), false);

includes("inline code", renderMarkdown("run `npm test` now"), "<code>npm test</code>");
check("formatting inside inline code is untouched", renderMarkdown("`**x**`").includes("<strong>"), false);

const table = renderMarkdown("| a | b |\n| --- | ---: |\n| 1 | 2 |");
includes("tables render", table, "<table>");
includes("alignment is carried", table, 'style="text-align:right"');
includes("a header row is distinguished", table, "<th");

const bare = renderMarkdown("see https://example.com/x for more");
includes("bare URLs are linked", bare, 'href="https://example.com/x"');
check("a bare URL is not double-linked", (bare.match(/<a /g) ?? []).length, 1);

// A URL inside a generated href must not be linked again.
check("generated anchors are left alone", (goodLink.match(/<a /g) ?? []).length, 1);

check("single newlines are kept as breaks", renderMarkdown("one\ntwo"), "<p>one<br />two</p>");
check("blank lines separate paragraphs", (renderMarkdown("one\n\ntwo").match(/<p>/g) ?? []).length, 2);

// --- terminal noise -------------------------------------------------------
check("ansi colour codes are stripped", stripAnsi("\u001b[31mred\u001b[0m"), "red");
check("ansi does not leak into rendered output", renderMarkdown("a \u001b[1mb\u001b[0m") .includes("\u001b"), false);

// --- robustness -----------------------------------------------------------
check("empty input", renderMarkdown(""), "");
check("unterminated fence still renders", renderMarkdown("```\nx").includes("<pre"), true);
check("a lone pipe is not a table", renderMarkdown("a | b").includes("<table>"), false);
check("an empty list item does not throw", renderMarkdown("- ").includes("<li>"), true);

if (failures.length > 0) {
	console.error(`markdown check failed:\n  - ${failures.join("\n  - ")}`);
	process.exit(1);
}
console.log("markdown check ok: escaping, links, blocks, and terminal noise");
