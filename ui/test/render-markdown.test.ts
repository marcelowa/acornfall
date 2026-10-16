import { describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";

/**
 * The renderer's security and fidelity, in the tier that fits: DOMPurify binds to a window
 * when it is imported, so the DOM comes first and the module loads after it. jsdom is the
 * host implementation that supports what DOMPurify does; happy-dom parses the same fixture
 * into a tree where a forbidden tag inside a paragraph survives, which is a green test that
 * proves nothing.
 *
 * These are the assertions the old client's browser suite made through its own module; the
 * browser suite now only has to prove the pane renders, because this is where the parsing
 * and the sanitising actually live.
 */
const browser = new JSDOM("<!doctype html><html><body></body></html>");
(globalThis as { window?: unknown }).window = browser.window;
(globalThis as { document?: unknown }).document = browser.window.document;

const { renderMarkdown } = await import("../src/components/transcript/render-markdown");

describe("the markdown renderer", () => {
	test("renders emphasis, lists, and tables", () => {
		const html = renderMarkdown("**bold**\n\n- one\n\n| a | b |\n| - | - |\n| 1 | 2 |");
		expect(html).toContain("<strong>");
		expect(html).toContain("<li>");
		expect(html).toContain("<table>");
	});

	test("single newlines stay line breaks", () => {
		expect(renderMarkdown("one\ntwo")).toContain("<br");
	});

	test("links are hardened", () => {
		const html = renderMarkdown("[x](https://example.com)");
		expect(html).toContain('rel="noreferrer noopener"');
		expect(html).toContain('target="_blank"');
	});

	test("code is highlighted, and an unknown language still renders as code", () => {
		expect(renderMarkdown("```ts\nconst x = 1;\n```")).toContain("hljs-");
		expect(renderMarkdown("```nosuchlanguage\nx\n```")).toContain("<pre>");
	});

	test("raw script tags do not survive, and their text is still visible", () => {
		const html = renderMarkdown("<script>alert(1)</script>");
		expect(html).not.toContain("<script");
		expect(html).toContain("&lt;script&gt;");
	});

	test("raw html does not become an element", () => {
		const html = renderMarkdown('<img src="x" onerror="alert(1)">');
		expect(html).not.toContain("<img");
		expect(html).toContain("&lt;img");
	});

	test("javascript: links lose their href", () => {
		expect(renderMarkdown("[x](javascript:alert(1))")).not.toContain("javascript:");
	});

	test("images are refused", () => {
		expect(renderMarkdown("![alt](https://example.com/x.png)")).not.toContain("<img");
	});

	test("an alert marker becomes a callout, and the marker itself is gone", () => {
		const html = renderMarkdown("> [!WARNING]\n> careful **now**");
		expect(html).toContain('class="callout callout-warning"');
		expect(html).toContain("Warning");
		expect(html).toContain("<strong>now</strong>");
		expect(html).not.toContain("[!");
	});

	test("a quote without a marker is still a quote", () => {
		expect(renderMarkdown("> just a quote")).toContain("<blockquote>");
	});

	test("a marker with words on its line is a quote, not an alert", () => {
		const html = renderMarkdown("> [!WARNING] careful");
		expect(html).toContain("<blockquote>");
		expect(html).not.toContain("callout");
	});

	test("a callout body is sanitised like any other text", () => {
		const html = renderMarkdown("> [!CAUTION]\n> <script>alert(1)</script>");
		expect(html).toContain("callout-caution");
		expect(html).not.toContain("<script");
	});

	test("a checklist keeps a box per item and a count", () => {
		const html = renderMarkdown("- [x] done\n- [ ] waiting");
		expect(html).toContain('class="task-list"');
		expect(html).toContain("1/2");
		expect(html).toContain('class="task-box is-done"');
		expect(html).toContain('class="task-box"');
		expect(html).not.toContain("<input");
	});

	test("a list that is only partly tasks is a list, with its boxes inline", () => {
		const html = renderMarkdown("- [x] a task\n- just an item");
		expect(html).not.toContain("task-list");
		expect(html).toContain('class="task-box is-done"');
	});

	test("a steps fence draws a plan, and the fence itself is gone", () => {
		const html = renderMarkdown(
			"```steps\ndone: read it\ndoing: build it\nblocked: on the key\ntodo: run it\n```",
		);
		expect(html).toContain('class="steps"');
		for (const kind of ["done", "doing", "blocked", "todo"]) {
			expect(html).toContain(`step-${kind}`);
		}
		expect(html).not.toContain("code-block");
	});

	test("a step without a known state keeps its own words", () => {
		const html = renderMarkdown("```steps\nwaiting: on the key\n```");
		expect(html).toContain("step-todo");
		expect(html).toContain("waiting: on the key");
	});

	test("a step holds inline markdown, and a hostile one is escaped", () => {
		const html = renderMarkdown(
			"```steps\ndoing: run `make test`\ntodo: <script>alert(1)</script>\n```",
		);
		expect(html).toContain("<code>make test</code>");
		expect(html).not.toContain("<script");
		expect(html).toContain("&lt;script&gt;");
	});

	test("an empty steps fence stays a code block", () => {
		expect(renderMarkdown("```steps\n```")).toContain("code-block");
	});

	test("a matrix draws a tinted cell per state, under its column names", () => {
		const html = renderMarkdown(
			"```matrix\ntarget | unit | e2e\nlinux | pass | fail\nmac | skip | pass\n```",
		);
		expect(html).toContain('class="matrix"');
		expect(html).toContain('class="matrix-row matrix-head"');
		expect(html).toContain('cell-ok">pass');
		expect(html).toContain('cell-fail">fail');
		expect(html).toContain('cell-warn">skip');
		expect(html).not.toContain("code-block");
	});

	test("a matrix that does not line up, or names no state, stays a code block", () => {
		for (const fence of [
			"```matrix\na | b\nlinux | pass | fail\n```",
			"```matrix\na | b\nlinux | sluggish\n```",
			"```matrix\na | b\n```",
		]) {
			expect(renderMarkdown(fence)).toContain("code-block");
		}
	});

	test("a stats fence draws a tile per fact, and a value may hold anything", () => {
		const html = renderMarkdown("```stats\ncommit: 244e804\nfiles: 12\ndiff: +414 −75\n```");
		expect(html).toContain('class="stats"');
		expect(html).toContain('stat-label">commit');
		expect(html).toContain("+414 −75");
	});

	test("a stats fence with an empty side stays a code block", () => {
		expect(renderMarkdown("```stats\ncommit:\n```")).toContain("code-block");
		expect(renderMarkdown("```stats\nno colon here\n```")).toContain("code-block");
	});

	test("a tree draws the shape of the paths, not the paths", () => {
		const html = renderMarkdown(
			"```tree\nui/src/chart.tsx\nui/src/chart.css\nworker/src/main.ts\n```",
		);
		expect(html).toContain('class="tree"');
		expect(html).toContain('tree-dir" title="ui/">ui/');
		expect(html).toContain('tree-file" title="chart.tsx">chart.tsx');
		// Two files under one directory: the shared segment is written once.
		expect(html.split(">ui/").length - 1).toBe(1);
	});

	test("a tree of paths with nothing in common is still a tree of names", () => {
		expect(renderMarkdown("```tree\nREADME.md\n```")).toContain('tree-file" title="README.md"');
	});
});
