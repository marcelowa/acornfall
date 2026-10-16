import { describe, expect, test } from "bun:test";
import { splitMermaid } from "../src/components/transcript/mermaid-source";

describe("splitting a reply at its Mermaid fences", () => {
	test("prose around a diagram stays prose", () => {
		const segments = splitMermaid("before\n\n```mermaid\ngraph TD\n  A --> B\n```\n\nafter");
		expect(segments).toEqual([
			{ kind: "text", text: "before\n\n" },
			{ kind: "mermaid", source: "graph TD\n  A --> B" },
			{ kind: "text", text: "\nafter" },
		]);
	});

	test("a reply with no fence is one text segment", () => {
		expect(splitMermaid("just prose")).toEqual([{ kind: "text", text: "just prose" }]);
	});

	test("a fence that is still open stays text", () => {
		const segments = splitMermaid("prose\n\n```mermaid\ngraph TD\n  A -->");
		expect(segments).toEqual([
			{ kind: "text", text: "prose\n\n```mermaid\ngraph TD\n  A -->" },
		]);
	});

	test("another language's fence is not a diagram, and hides what it holds", () => {
		const source = "```\n```mermaid\ngraph TD\n```\n";
		expect(splitMermaid(source)).toEqual([{ kind: "text", text: source }]);
	});

	test("a longer fence holds a shorter one", () => {
		const source = "````\n```mermaid\ngraph TD\n```\n````\n";
		expect(splitMermaid(source)).toEqual([{ kind: "text", text: source }]);
	});

	test("tildes work, and a closing fence may be longer than its opener", () => {
		expect(splitMermaid("~~~mermaid\ngraph TD\n~~~~~")).toEqual([
			{ kind: "mermaid", source: "graph TD" },
		]);
	});

	test("a directive inside the diagram is dropped", () => {
		const segments = splitMermaid('```mermaid\n%%{init: {"theme": "dark"}}%%\ngraph TD\n```');
		expect(segments).toEqual([{ kind: "mermaid", source: "graph TD" }]);
	});

	test("an info string that is not plain mermaid stays a code block", () => {
		const source = "```mermaid extra\ngraph TD\n```";
		expect(splitMermaid(source)).toEqual([{ kind: "text", text: source }]);
	});

	test("two diagrams in one reply", () => {
		const segments = splitMermaid("```mermaid\na --> b\n```\n\n```mermaid\nc --> d\n```");
		expect(segments).toEqual([
			{ kind: "mermaid", source: "a --> b" },
			{ kind: "text", text: "\n" },
			{ kind: "mermaid", source: "c --> d" },
		]);
	});
});
