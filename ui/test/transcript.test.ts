import { describe, expect, test } from "bun:test";
import { groupTurns } from "../src/lib/turns";
import type { TranscriptEntry } from "../src/app/view-models";

const at = new Date(2026, 9, 6, 14, 32);

const user = (id: string): TranscriptEntry => ({ kind: "user", id, at, text: id });
const assistant = (id: string): TranscriptEntry => ({
	kind: "assistant",
	id,
	at,
	markdown: id,
});

describe("transcript turns", () => {
	test("a user entry starts a turn; tools and replies ride with it", () => {
		const tool: TranscriptEntry = {
			kind: "tool",
			id: "t",
			at,
			name: "bash",
			status: "done",
			isError: false,
			output: "ok",
		};
		const turns = groupTurns([user("u1"), assistant("a1"), tool, user("u2")]);
		expect(turns).toHaveLength(2);
		expect(turns[0]?.map((entry: TranscriptEntry) => entry.id)).toEqual(["u1", "a1", "t"]);
		expect(turns[1]?.map((entry: TranscriptEntry) => entry.id)).toEqual(["u2"]);
	});

	test("leading entries before the first user form their own turn", () => {
		const notice: TranscriptEntry = { kind: "notice", id: "n", at, text: "compacted" };
		const turns = groupTurns([notice, user("u1")]);
		expect(turns).toHaveLength(2);
		expect(turns[0]?.map((entry: TranscriptEntry) => entry.id)).toEqual(["n"]);
	});

	test("empty stays empty", () => {
		expect(groupTurns([])).toEqual([]);
	});
});
