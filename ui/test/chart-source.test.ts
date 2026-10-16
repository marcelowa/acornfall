import { describe, expect, test } from "bun:test";
import { MAX_POINTS, chartRefusal, parseChart } from "../src/components/transcript/chart-source";

/**
 * A chart is drawn only from a fence the parser reads completely: a chart that drops a line is a
 * chart that lies, so everything else comes back as `undefined` and the reader gets the source.
 */
describe("reading a chart fence", () => {
	test("a name and a number per line, in the order written", () => {
		expect(parseChart("passes: 131\nfails: 5")).toEqual([
			{ label: "passes", value: 131 },
			{ label: "fails", value: 5 },
		]);
	});

	test("blank lines around the bars are nothing", () => {
		expect(parseChart("\npasses: 2\n\n")).toEqual([{ label: "passes", value: 2 }]);
	});

	test("a decimal is a number, and a label may hold spaces or a colon", () => {
		expect(parseChart("first run: 2.5")).toEqual([{ label: "first run", value: 2.5 }]);
		expect(parseChart("a: b: 3")).toEqual([{ label: "a: b", value: 3 }]);
	});

	test("a line that is not name: number is no chart at all", () => {
		expect(parseChart("passes: 131\nfails a lot")).toBeUndefined();
		expect(parseChart("passes 131")).toBeUndefined();
		expect(parseChart("passes: -3")).toBeUndefined();
		expect(parseChart("passes: 1,204")).toBeUndefined();
		expect(parseChart("")).toBeUndefined();
	});

	test("more bars than the console draws is a table, not a chart", () => {
		const many = Array.from({ length: MAX_POINTS + 1 }, (_, index) => `bar ${index}: 1`).join(
			"\n",
		);
		expect(parseChart(many)).toBeUndefined();
		expect(parseChart(many.split("\n").slice(0, MAX_POINTS).join("\n"))).toHaveLength(
			MAX_POINTS,
		);
	});

	test("a refusal says which of the two things went wrong", () => {
		expect(chartRefusal("passes: 131\nfails a lot")).toContain("name: number");
		expect(
			chartRefusal(Array.from({ length: MAX_POINTS + 1 }, () => "a: 1").join("\n")),
		).toContain(`${MAX_POINTS}`);
	});
});
