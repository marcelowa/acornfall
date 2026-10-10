import { describe, expect, test } from "bun:test";
import { PICKER_FILTER_AFTER, filterPickerGroups } from "../src/components/composer/picker";
import type { PickerGroup } from "../src/app/view-models";

const groups: PickerGroup[] = [
	{
		label: "opencode-go",
		options: [
			{ value: "opencode-go/opus-5", label: "Opus 5" },
			{ value: "opencode-go/sonnet-6", label: "Sonnet 6" },
		],
	},
	{
		label: "local",
		options: [{ value: "local/llama", label: "Llama" }],
	},
];

describe("picker narrowing", () => {
	test("the filter arrives at the same count the slash menu caps at", () => {
		expect(PICKER_FILTER_AFTER).toBe(8);
	});

	test("an empty query is the whole list", () => {
		expect(filterPickerGroups(groups, "")).toEqual(groups);
		expect(filterPickerGroups(groups, "   ")).toEqual(groups);
	});

	test("the label and the value both count", () => {
		const byLabel = filterPickerGroups(groups, "opus");
		expect(byLabel).toHaveLength(1);
		expect(byLabel[0]?.options.map((option) => option.value)).toEqual(["opencode-go/opus-5"]);
		const byValue = filterPickerGroups(groups, "local/llama");
		expect(byValue).toHaveLength(1);
		expect(byValue[0]?.label).toBe("local");
	});

	test("matching ignores case, and empty groups fall away", () => {
		const narrowed = filterPickerGroups(groups, "LLAMA");
		expect(narrowed).toHaveLength(1);
		expect(narrowed[0]?.label).toBe("local");
	});

	test("nothing matching is no groups, not an empty one", () => {
		expect(filterPickerGroups(groups, "nothing-like-this")).toEqual([]);
	});
});
