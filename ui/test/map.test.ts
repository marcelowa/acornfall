import { describe, expect, test } from "bun:test";
import {
	failureOf,
	originLabel,
	textOf,
	toAgentGroups,
	toConversation,
	toModelChoices,
	toSandbox,
	toTranscript,
	toWorkspaces,
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

	test("agents are grouped by layer, with the description a name cannot carry", () => {
		const groups = toAgentGroups([
			{ name: "a", source: "/a.md", layer: "workspace", description: "does a" },
			{ name: "b", source: "/b.md", layer: "install" },
			{ name: "c", source: "/c.md", layer: "workspace" },
		]);
		expect(groups.map((group) => group.label)).toEqual(["workspace", "install"]);
		expect(groups[0]?.options.map((option) => option.value)).toEqual(["a", "c"]);
		expect(groups[0]?.options[0]?.description).toBe("does a");
		expect(groups[1]?.options[0]?.description).toBe("/b.md");
	});

	test("accepted messages that have not committed are shown as pending", () => {
		const view: WireView = {
			entries: [],
			docs: {
				"pi.inbox": {
					items: [
						{ id: "a", mode: "steer", content: "wait, check the lock order" },
						{ id: "b", mode: "followUp", content: "then update the changelog" },
						// The harness's own drafts are not a person's words.
						{ id: "c", mode: "write", content: "internal reset" },
						{ id: "d", mode: "steer", content: "   " },
					],
				},
			},
		};
		const entries = toTranscript(view, {});
		expect(entries).toHaveLength(2);
		const [steer, followUp] = entries;
		expect(steer?.kind === "pending" ? steer.action : undefined).toBe("steer");
		expect(steer?.kind === "pending" ? steer.text : undefined).toBe(
			"wait, check the lock order",
		);
		expect(followUp?.id).toBe("pending-b");
	});

	test("workspaces are listed with the one in view marked", () => {
		const workspaces = toWorkspaces(
			[
				{
					name: "general",
					title: "acornfall",
					path: "/acornfall",
					general: true,
					running: true,
				},
				{
					name: "demo",
					title: "Demo",
					path: "/tmp/ws-demo",
					general: false,
					running: false,
					network: "off",
				},
			],
			"demo",
		);
		expect(workspaces.map((workspace) => workspace.active)).toEqual([false, true]);
		expect(workspaces[1]?.network).toBe("off");
	});

	test("a sandbox that is not isolated says so", () => {
		const sandbox = toSandbox({
			engine: "host",
			status: "Running",
			tools: true,
			isolated: false,
		});
		expect(sandbox.isolated).toBe(false);
		expect(sandbox.engine).toBe("host");
	});
});
