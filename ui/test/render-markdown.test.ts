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
});
