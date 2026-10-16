import { describe, expect, test } from "bun:test";
import { JSDOM } from "jsdom";

/**
 * The guard around Mermaid's output, on fixtures rather than on a real diagram: jsdom cannot lay
 * an SVG out, so Mermaid cannot run here at all. The shape is what is being tested — the tags that
 * fetch, the handlers, and the labels that have to survive.
 */
const browser = new JSDOM("<!doctype html><html><body></body></html>", {
	contentType: "text/html",
});
(globalThis as { window?: unknown }).window = browser.window;
(globalThis as { document?: unknown }).document = browser.window.document;

const { guardSvg } = await import("../src/lib/svg-guard");

const FLOWCHART = `<svg xmlns="http://www.w3.org/2000/svg" class="flowchart" viewBox="0 0 100 100">
	<style>#demo{fill:#fff} .node{clip-path:url(#clip-1)}</style>
	<defs><marker id="arrow"><path d="M0 0" fill="#000"/></marker></defs>
	<foreignObject width="80" height="20"><div xmlns="http://www.w3.org/1999/xhtml">
		<span class="nodeLabel"><p>Ask</p></span>
	</div></foreignObject>
	<text class="edgeLabel">yes</text>
</svg>`;

describe("the SVG guard", () => {
	test("labels inside a foreignObject survive", () => {
		const svg = guardSvg(FLOWCHART);
		expect(svg).not.toBeNull();
		expect(svg?.querySelector("p")?.textContent).toBe("Ask");
		expect(svg?.querySelector("span")?.getAttribute("class")).toBe("nodeLabel");
		expect(svg?.querySelector("text")?.textContent).toBe("yes");
		expect(svg?.getAttribute("viewBox")).toBe("0 0 100 100");
	});

	test("Mermaid's own style block and markers survive", () => {
		const svg = guardSvg(FLOWCHART);
		expect(svg?.querySelector("style")?.textContent).toBe(
			"#demo{fill:#fff} .node{clip-path:url(#clip-1)}",
		);
		expect(svg?.querySelector("marker")?.getAttribute("id")).toBe("arrow");
	});

	test("a script element is removed", () => {
		const svg = guardSvg(
			'<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
		);
		expect(svg?.querySelector("script")).toBeNull();
	});

	test("an image inside a label is removed and the label stays", () => {
		const svg = guardSvg(
			'<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div><img src="y"><p>Ask</p></div></foreignObject></svg>',
		);
		expect(svg).not.toBeNull();
		expect(svg?.querySelectorAll("img").length).toBe(0);
		expect(svg?.querySelector("p")?.textContent).toBe("Ask");
	});

	test("a void tag in a label does not sink the drawing", () => {
		// Mermaid writes a label's HTML into the SVG string as it found it, so an unclosed `<img>`
		// arrives here: the string is not XML, and the drawing is still a drawing.
		const svg = guardSvg(
			'<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><div><p>Ask<img src="y"></p></div></foreignObject></svg>',
		);
		expect(svg).not.toBeNull();
		expect(svg?.querySelectorAll("img").length).toBe(0);
		expect(svg?.querySelector("p")?.textContent).toBe("Ask");
	});

	test("an HTML tag in SVG position refuses the drawing rather than half of it", () => {
		// The parser closes the `<svg>` early and puts the rest beside it. Rendering the fragment
		// would be a picture the model did not write, so there is no drawing to return.
		expect(guardSvg('<svg xmlns="http://www.w3.org/2000/svg"><img src="x"/></svg>')).toBeNull();
	});

	test("event handlers are removed", () => {
		const svg = guardSvg(
			'<svg xmlns="http://www.w3.org/2000/svg" onload="x()"><rect onclick="x()" fill="red"/></svg>',
		);
		expect(svg?.getAttribute("onload")).toBeNull();
		expect(svg?.querySelector("rect")?.getAttribute("onclick")).toBeNull();
		expect(svg?.querySelector("rect")?.getAttribute("fill")).toBe("red");
	});

	test("a link out of the drawing is removed, a link inside it stays", () => {
		const svg = guardSvg(
			'<svg xmlns="http://www.w3.org/2000/svg"><a href="https://example.com"><text>out</text></a><use href="#arrow"/></svg>',
		);
		expect(svg?.querySelector("a")?.getAttribute("href")).toBeNull();
		expect(svg?.querySelector("use")?.getAttribute("href")).toBe("#arrow");
	});

	test("a stylesheet import and a remote url in CSS become nothing", () => {
		const svg = guardSvg(
			'<svg xmlns="http://www.w3.org/2000/svg"><style>@import url("http://elsewhere/x.css"); .n{fill:url(http://elsewhere/x.png)} .m{fill:url(#tint)}</style><rect style="fill:url(http://elsewhere/y.png)"/></svg>',
		);
		expect(svg?.querySelector("style")?.textContent).toBe(" .n{fill:none} .m{fill:url(#tint)}");
		expect(svg?.querySelector("rect")?.getAttribute("style")).toBe("fill:none");
	});

	test("something that is not an SVG is refused rather than patched", () => {
		expect(guardSvg("<p>not a drawing</p>")).toBeNull();
		expect(guardSvg("")).toBeNull();
	});
});
