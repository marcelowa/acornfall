import { describe, expect, test } from "bun:test";
import {
	failureOf,
	originLabel,
	textOf,
	toConversation,
	toModelChoices,
	toTranscript,
} from "../src/app/map";
import type { WireConversation, WireView } from "../src/app/wire";

const conversation = (over: Partial<WireConversation> = {}): WireConversation => ({
	id: "3",
	title: "The stream sends state views",
	root: false,
	hidden: false,
	running: false,
	lastEntryId: "9",
	tokens: 0,
	cost: 0,
	...over,
});

describe("the wire mapping", () => {
	test("a conversation is unread when it moved and is not active", () => {
		expect(toConversation(conversation(), "1", "8").unread).toBe(true);
		expect(toConversation(conversation(), "3", "8").unread).toBe(false);
		expect(toConversation(conversation(), "1", "9").unread).toBe(false);
		expect(toConversation(conversation({ hidden: true }), "1", "8").unread).toBe(false);
	});

	test("a user entry keeps its sender and forks at the entry before it", () => {
		const view: WireView = {
			entries: [
				{ id: 1, kind: "pi.user", model: [{ content: "first" }] },
				{ id: 2, kind: "pi.user", model: [{ content: "second" }] },
			],
		};
		const entries = toTranscript(view, {
			"2": { kind: "ask", name: "scout", conversationId: "1" },
		});
		expect(entries).toHaveLength(2);
		const [first, second] = entries;
		if (first?.kind !== "user" || second?.kind !== "user") throw new Error("expected users");
		expect(first.forkAt).toBeUndefined();
		expect(second.forkAt).toBe("1");
		expect(second.sender?.name).toBe("scout");
	});

	test("a tool result takes its arguments from the call it answers", () => {
		const view: WireView = {
			entries: [
				{
					id: 1,
					kind: "pi.assistant",
					model: [
						{
							content: [
								{
									type: "toolCall",
									id: "c1",
									name: "bash",
									arguments: { command: "ls" },
								},
							],
						},
					],
				},
				{
					id: 2,
					kind: "pi.tool-result",
					model: [{ content: "ok", toolCallId: "c1", toolName: "bash", isError: false }],
				},
			],
		};
		const entries = toTranscript(view, {});
		const tool = entries.find((entry) => entry.kind === "tool");
		if (tool?.kind !== "tool") throw new Error("expected a tool card");
		expect(tool.name).toBe("bash");
		expect(tool.args).toEqual({ command: "ls" });
		expect(tool.status).toBe("done");
	});

	test("a provider failure becomes the pane", () => {
		const view: WireView = {
			entries: [
				{
					id: 1,
					kind: "pi.assistant",
					model: [
						{
							content: "",
							stopReason: "error",
							errorMessage: "429",
							provider: "p",
							model: "m",
						},
					],
				},
			],
		};
		const entry = toTranscript(view, {})[0];
		expect(entry?.kind === "assistant" ? entry.failure : undefined).toBe("p/m: 429");
	});

	test("live text has no controls until it settles", () => {
		const view: WireView = {
			entries: [],
			docs: { "pi.live": { generation: { message: { content: "half a sen" } }, tools: [] } },
		};
		const entry = toTranscript(view, {})[0];
		expect(entry?.kind === "assistant" ? entry.live : undefined).toBe(true);
	});

	test("a settled live tool is not drawn twice", () => {
		const view: WireView = {
			entries: [
				{ id: 1, kind: "pi.tool-result", model: [{ content: "ok", toolCallId: "c1" }] },
			],
			docs: {
				"pi.live": {
					tools: [{ callId: "c1", name: "bash", output: "ok", status: "running" }],
				},
			},
		};
		expect(toTranscript(view, {}).filter((entry) => entry.kind === "tool")).toHaveLength(1);
	});

	test("failureOf ignores a clean message", () => {
		expect(failureOf({ content: "fine", stopReason: "stop" })).toBeUndefined();
		expect(failureOf(undefined)).toBeUndefined();
	});

	test("textOf joins only text blocks", () => {
		expect(
			textOf([
				{ type: "thinking", text: "hmm" },
				{ type: "text", text: "hi" },
			]),
		).toBe("hi");
	});

	test("a provider without a credential is not a model choice", () => {
		const choices = toModelChoices([
			{
				id: "wired",
				name: "Wired",
				authenticated: true,
				models: [{ id: "opus-5", name: "Opus 5", thinkingLevels: ["low", "high"] }],
			},
			{ id: "dead", name: "Dead", authenticated: false, models: [{ id: "x", name: "X" }] },
		]);
		expect(choices).toHaveLength(1);
		expect(choices[0]?.value).toBe("wired/opus-5");
		expect(choices[0]?.thinkingLevels).toEqual(["low", "high"]);
	});

	test("an origin is said in words", () => {
		expect(originLabel("workspace")).toBe("workspace default");
		expect(originLabel("install")).toBe("install default");
		expect(originLabel("last-resort")).toBe("last resort");
		expect(originLabel(undefined)).toBeUndefined();
	});
});
