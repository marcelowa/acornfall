/**
 * The thinking scale, and the one check for it. A level reaches the harness from three
 * directions — an agent's frontmatter, control's default, and the `thinking` argument the model
 * passes to the subagent tool — and the last of those used to be cast into place unchecked.
 */
import { describe, expect, test } from "bun:test";
import { THINKING_LEVELS, thinkingLevelFor } from "../src/thinking.ts";

describe("the thinking scale", () => {
	test("names every level, weakest first", () => {
		expect([...THINKING_LEVELS]).toEqual(["off", "minimal", "low", "medium", "high", "xhigh", "max"]);
	});

	test("accepts each of them", () => {
		for (const level of THINKING_LEVELS) expect(thinkingLevelFor(level)).toBe(level);
	});

	test("no level at all is null, which is not the same as an error", () => {
		expect(thinkingLevelFor(undefined)).toBeNull();
		expect(thinkingLevelFor("")).toBeNull();
	});

	test("refuses anything else, saying what was expected", () => {
		expect(() => thinkingLevelFor("banana")).toThrow(/unknown thinking level "banana"/);
		expect(() => thinkingLevelFor("banana")).toThrow(/expected one of off, minimal/);
		expect(() => thinkingLevelFor("HIGH")).toThrow(/unknown thinking level/);
		expect(() => thinkingLevelFor("off ")).toThrow(/unknown thinking level/);
	});
});
