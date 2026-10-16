import { describe, expect, test } from "bun:test";
import { splitBlocks } from "../src/components/transcript/markdown-blocks";

describe("splitting a reply at the fences the console draws", () => {
	test("prose around a diagram stays prose", () => {
		const segments = splitBlocks("before\n\n```mermaid\ngraph TD\n  A --> B\n```\n\nafter");
		expect(segments).toEqual([
			{ kind: "text", text: "before\n\n" },
			{ kind: "mermaid", source: "graph TD\n  A --> B" },
			{ kind: "text", text: "\nafter" },
		]);
	});

	test("a reply with no fence is one text segment", () => {
		expect(splitBlocks("just prose")).toEqual([{ kind: "text", text: "just prose" }]);
	});

	test("a fence that is still open stays text", () => {
		const segments = splitBlocks("prose\n\n```mermaid\ngraph TD\n  A -->");
		expect(segments).toEqual([
			{ kind: "text", text: "prose\n\n```mermaid\ngraph TD\n  A -->" },
		]);
	});

	test("another language's fence is not a diagram, and hides what it holds", () => {
		const source = "```\n```mermaid\ngraph TD\n```\n";
		expect(splitBlocks(source)).toEqual([{ kind: "text", text: source }]);
	});

	test("a longer fence holds a shorter one", () => {
		const source = "````\n```mermaid\ngraph TD\n```\n````\n";
		expect(splitBlocks(source)).toEqual([{ kind: "text", text: source }]);
	});

	test("tildes work, and a closing fence may be longer than its opener", () => {
		expect(splitBlocks("~~~mermaid\ngraph TD\n~~~~~")).toEqual([
			{ kind: "mermaid", source: "graph TD" },
		]);
	});

	test("a directive inside the diagram is dropped", () => {
		const segments = splitBlocks('```mermaid\n%%{init: {"theme": "dark"}}%%\ngraph TD\n```');
		expect(segments).toEqual([{ kind: "mermaid", source: "graph TD" }]);
	});

	test("an info string that is not plain mermaid stays a code block", () => {
		const source = "```mermaid extra\ngraph TD\n```";
		expect(splitBlocks(source)).toEqual([{ kind: "text", text: source }]);
	});

	test("two diagrams in one reply", () => {
		const segments = splitBlocks("```mermaid\na --> b\n```\n\n```mermaid\nc --> d\n```");
		expect(segments).toEqual([
			{ kind: "mermaid", source: "a --> b" },
			{ kind: "text", text: "\n" },
			{ kind: "mermaid", source: "c --> d" },
		]);
	});

	test("a chart fence is a segment of its own, and keeps what it holds", () => {
		const segments = splitBlocks("counts:\n\n```chart\npasses: 131\nfails: 5\n```\n");
		expect(segments).toEqual([
			{ kind: "text", text: "counts:\n\n" },
			{ kind: "chart", source: "passes: 131\nfails: 5" },
			{ kind: "text", text: "" },
		]);
	});

	test("an open chart fence stays text, like a diagram's", () => {
		const segments = splitBlocks("prose\n\n```chart\npasses: 131");
		expect(segments).toEqual([{ kind: "text", text: "prose\n\n```chart\npasses: 131" }]);
	});

	test("a directive is Mermaid's, and a chart keeps its own lines", () => {
		const source = '```chart\n%%{init: {"theme": "dark"}}%%: 1\n```';
		expect(splitBlocks(source)).toEqual([
			{ kind: "chart", source: '%%{init: {"theme": "dark"}}%%: 1' },
		]);
	});
});

describe("the fences that are drawn, not printed", () => {
	test("a spark fence is a segment of its own", () => {
		expect(splitBlocks("```spark\n1 4 2 8\n```")).toEqual([
			{ kind: "spark", source: "1 4 2 8" },
		]);
	});

	test("a spark fence that is still open stays text", () => {
		const source = "prose\n\n```spark\n1 4";
		expect(splitBlocks(source)).toEqual([{ kind: "text", text: source }]);
	});

	test("a fence the console does not draw is left where it is", () => {
		const source = '```json\n{"a": 1}\n```';
		expect(splitBlocks(source)).toEqual([{ kind: "text", text: source }]);
	});
});
