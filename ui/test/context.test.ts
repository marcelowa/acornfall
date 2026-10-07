import { describe, expect, test } from "bun:test";
import { foldContext, lastUsage } from "../src/app/context";
import type { WireEntry } from "../src/app/wire";

/**
 * The fixtures are the old client's, kept verbatim: a base snapshot, then an instructions
 * patch, then a tool patch. They came from a live conversation, which is why they are shaped
 * the way the harness actually shapes them.
 */
const entries: WireEntry[] = [
	{
		id: 10,
		kind: "pi.system",
		model: [
			{
				content: "",
				sections: {
					skills: "skills text",
					preamble: "preamble text",
					cwd: "<cwd>\n/acornfall\n</cwd>",
				},
				toolsAdded: [
					{ name: "read", description: "read a file", parameters: { type: "object" } },
					{ name: "write", description: "write a file", parameters: { type: "object" } },
					{ name: "edit", description: "edit a file", parameters: { type: "object" } },
					{ name: "bash", description: "run a command", parameters: { type: "object" } },
					{ name: "skill", description: "load a skill", parameters: { type: "object" } },
				],
			},
		],
	},
	{
		id: 71,
		kind: "pi.system",
		model: [{ content: "", sections: { instructions: "global + workspace + agent" } }],
	},
	{
		id: 92,
		kind: "pi.system",
		model: [
			{
				content: "",
				sections: { instructions: "edited" },
				toolsRemoved: [{ name: "write" }, { name: "edit" }],
			},
		],
	},
	{
		id: 93,
		kind: "pi.assistant",
		model: [{ content: [], usage: { input: 100, output: 20, cacheRead: 5, cacheWrite: 0 } }],
	},
];

describe("the context fold", () => {
	const history = foldContext(entries);

	test("one request per system entry", () => {
		expect(history).toHaveLength(3);
	});

	test("the first request carries the base snapshot", () => {
		expect([...(history[0]?.sections.keys() ?? [])]).toEqual(["skills", "preamble", "cwd"]);
		expect([...(history[0]?.tools.keys() ?? [])]).toEqual([
			"read",
			"write",
			"edit",
			"bash",
			"skill",
		]);
		expect(history[0]?.previousId).toBeNull();
	});

	test("a patch folds forward instead of replacing", () => {
		expect([...(history[1]?.sections.keys() ?? [])]).toEqual([
			"skills",
			"preamble",
			"cwd",
			"instructions",
		]);
		expect(history[1]?.changes.sectionsAdded).toEqual(["instructions"]);
		expect(history[1]?.changes.sectionsChanged).toEqual([]);
		expect(history[1]?.changes.toolsAdded).toEqual([]);
	});

	test("an edited section is a change, not an addition", () => {
		expect(history[2]?.changes.sectionsChanged).toEqual(["instructions"]);
	});

	test("a removed tool leaves the request after it", () => {
		expect([...(history[2]?.tools.keys() ?? [])]).toEqual(["read", "bash", "skill"]);
		expect(history[2]?.changes.toolsRemoved).toEqual(["write", "edit"]);
	});

	test("a later request still sees the patched section", () => {
		expect(history[2]?.sections.get("instructions")).toBe("edited");
	});

	test("usage comes from the latest assistant entry", () => {
		expect(lastUsage(entries)).toEqual({ input: 100, output: 20, cacheRead: 5, cacheWrite: 0 });
	});

	test("null removes a section and says so", () => {
		const removed = foldContext([
			...(entries.slice(0, 1) as WireEntry[]),
			{
				id: 30,
				kind: "pi.system",
				model: [{ content: "", sections: { skills: null } }],
			},
		]);
		expect([...(removed[1]?.sections.keys() ?? [])]).toEqual(["preamble", "cwd"]);
		expect(removed[1]?.changes.sectionsRemoved).toEqual(["skills"]);
	});

	test("a request's snapshot does not move when the fold does", () => {
		const first = history[0];
		expect(first?.sections.has("instructions")).toBe(false);
	});
});
