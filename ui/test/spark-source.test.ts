import { describe, expect, test } from "bun:test";
import { MANY, parseSpark, sparkRefusal } from "../src/components/transcript/spark-source";

/**
 * A sparkline is drawn only from a fence that is numbers all the way through: one it could not read
 * would be a shape nobody wrote, so everything else comes back as `undefined` and the reader gets
 * the source.
 */
describe("reading a spark fence", () => {
	test("numbers in a line, however they are spaced", () => {
		expect(parseSpark("1 4 2 8 5")).toEqual([1, 4, 2, 8, 5]);
		expect(parseSpark("1, 4, 2")).toEqual([1, 4, 2]);
		expect(parseSpark("1\n4\n2\n8")).toEqual([1, 4, 2, 8]);
		expect(parseSpark("-2 -1 0 1")).toEqual([-2, -1, 0, 1]);
		expect(parseSpark("0.5 1 1.5")).toEqual([0.5, 1, 1.5]);
	});

	test("fewer than three numbers is not a shape", () => {
		expect(parseSpark("1 4")).toBeUndefined();
		expect(parseSpark("")).toBeUndefined();
	});

	test("a line that is not all numbers is no sparkline", () => {
		expect(parseSpark("1 4 lots 8")).toBeUndefined();
		expect(parseSpark("1e3 4 8")).toEqual([1000, 4, 8]);
		expect(parseSpark("NaN 4 8")).toBeUndefined();
	});

	test("past the last point the console draws, it is a chart", () => {
		const many = Array.from({ length: MANY + 1 }, (_, index) => String(index)).join(" ");
		expect(parseSpark(many)).toBeUndefined();
		expect(parseSpark(many.split(" ").slice(0, MANY).join(" "))).toHaveLength(MANY);
	});

	test("a refusal says which of the three things went wrong", () => {
		expect(sparkRefusal("1 4")).toContain("fewer than");
		expect(sparkRefusal(Array.from({ length: MANY + 1 }, () => "1").join(" "))).toContain(
			`more than ${MANY}`,
		);
		expect(sparkRefusal("1 4 lots 8")).toContain("not a number");
	});
});
