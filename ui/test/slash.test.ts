import { describe, expect, test } from "bun:test";
import { SLASH_MAX_ROWS, stepSlashIndex } from "../src/components/composer/slash-menu";

describe("slash navigation", () => {
	test("arrow steps wrap around the list", () => {
		expect(stepSlashIndex(0, 1, 3)).toBe(1);
		expect(stepSlashIndex(2, 1, 3)).toBe(0);
		expect(stepSlashIndex(0, -1, 3)).toBe(2);
	});

	test("an empty list stays at zero", () => {
		expect(stepSlashIndex(0, 1, 0)).toBe(0);
	});

	test("the menu caps its rows", () => {
		expect(SLASH_MAX_ROWS).toBe(8);
	});
});
