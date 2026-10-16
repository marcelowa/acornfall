import { describe, expect, test } from "bun:test";
import { PREAMBLE } from "../src/preamble";

/**
 * The shapes the console draws. A new one has to be named in the preamble — a form the agent is
 * never told about is a form that never appears in a reply — so this list and that line move
 * together.
 */
const SHAPES = [
	"> [!WARNING]",
	"- [x]",
	"`steps`",
	"`chart`",
	"`spark`",
	"`matrix`",
	"`stats`",
	"`tree`",
	"`mermaid`",
];

describe("the preamble", () => {
	test("names every shape a reply can wear", () => {
		const missing = SHAPES.filter((shape) => !PREAMBLE.includes(shape));
		expect(missing).toEqual([]);
	});

	test("stays a preamble: every request pays for it", () => {
		expect(PREAMBLE.split("\n")).toHaveLength(5);
	});
});
