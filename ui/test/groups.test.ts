import { describe, expect, test } from "bun:test";
import { groupConversations } from "../src/components/conversation/conversation-list";
import type { ConversationSummary } from "../src/app/view-models";

const base: ConversationSummary = {
	id: "1",
	title: "t",
	root: false,
	hidden: false,
	running: false,
	unread: false,
	tokens: 0,
	cost: 0,
};

describe("conversation date groups", () => {
	test("renders flat when no timestamps are known", () => {
		const { groups, undated } = groupConversations([base]);
		expect(groups).toEqual([]);
		expect(undated).toHaveLength(1);
	});

	test("groups dated rows by recency", () => {
		const now = new Date(2026, 9, 8, 12, 0);
		const day = 86_400_000;
		const rows: ConversationSummary[] = [
			{ ...base, id: "today", updatedAt: now },
			{ ...base, id: "yesterday", updatedAt: new Date(now.getTime() - day) },
			{ ...base, id: "week", updatedAt: new Date(now.getTime() - 3 * day) },
			{ ...base, id: "older", updatedAt: new Date(now.getTime() - 30 * day) },
			{ ...base, id: "nodate" },
		];
		const { groups, undated } = groupConversations(rows, now);
		expect(groups.map((group) => group.label)).toEqual([
			"Today",
			"Yesterday",
			"This week",
			"Older",
		]);
		expect(undated.map((row) => row.id)).toEqual(["nodate"]);
	});
});
