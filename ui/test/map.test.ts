import { describe, expect, test } from "bun:test";
import {
	contextWindowFor,
	failureOf,
	stalePins,
	summaryOf,
	textOf,
	toAgentGroups,
	toConversation,
	toModelChoices,
	toProviders,
	toSandbox,
	toScopeDefaults,
	toTranscript,
	toWorkspaces,
} from "../src/app/map";
import type { WireConversation, WireProvider, WireState, WireView } from "../src/app/wire";

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

	test("last activity is mapped onto the date the rail groups by", () => {
		const when = Date.now();
		const dated = toConversation(conversation({ updatedAt: when }), "1", "9");
		expect(dated.updatedAt?.getTime()).toBe(when);
		// Absent stays absent: a conversation that never moved renders flat, in no group.
		expect(toConversation(conversation(), "1", "9").updatedAt).toBeUndefined();
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

	test("a compaction entry becomes a summary card with the note inside", () => {
		const view: WireView = {
			entries: [
				{
					id: 7,
					kind: "pi.compaction",
					model: [
						{
							content:
								"The conversation history before this point was compacted into the following summary:\n\n<summary>\nFixed the announcement.\n</summary>",
						},
					],
				},
			],
		};
		const entry = toTranscript(view, {})[0];
		if (entry?.kind !== "summary") throw new Error("expected a summary card");
		expect(entry.markdown).toBe("Fixed the announcement.");
	});

	test("a compaction entry without a note falls back to the bare line", () => {
		const view: WireView = { entries: [{ id: 7, kind: "pi.compaction" }] };
		const entry = toTranscript(view, {})[0];
		expect(entry?.kind === "notice" ? entry.text : undefined).toBe("context compacted");
		expect(summaryOf([])).toBeUndefined();
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

	test("a not-started tool counts as the run happening, not as done", () => {
		const view: WireView = {
			entries: [],
			docs: {
				"pi.live": {
					tools: [{ callId: "c1", name: "bash", output: "", status: "pending" }],
				},
			},
		};
		const [tool] = toTranscript(view, {});
		if (tool?.kind !== "tool") throw new Error("expected the live tool");
		expect(tool.status).toBe("running");
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

	test("the running model's window is found by provider and model id", () => {
		const providers: WireProvider[] = [
			{
				id: "wired",
				name: "Wired",
				authenticated: true,
				models: [
					{ id: "opus-5", name: "Opus 5", contextWindow: 200000 },
					{ id: "small", name: "Small" },
				],
			},
		];
		expect(contextWindowFor(providers, "wired/opus-5")).toBe(200000);
		expect(contextWindowFor(providers, "wired/small")).toBeUndefined();
		expect(contextWindowFor(providers, "wired/gone")).toBeUndefined();
		expect(contextWindowFor(providers, "dead/opus-5")).toBeUndefined();
		expect(contextWindowFor(providers, "")).toBeUndefined();
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

	test("a landed message keeps the mark it was sent with", () => {
		// The wire keeps no link between an inbox item and the entry it becomes, so the app claims
		// the mark by the message's own words and passes it in by entry id.
		const view: WireView = {
			entries: [
				{
					id: 7,
					kind: "pi.user",
					model: [{ content: "wait, check the lock order" }],
				},
			],
		};
		const entries = toTranscript(view, {}, false, { "7": "steer" });
		expect(entries[0]?.kind === "user" ? entries[0].action : undefined).toBe("steer");
	});

	test("a message with no claimed mark shows none", () => {
		const view: WireView = {
			entries: [{ id: 8, kind: "pi.user", model: [{ content: "an ordinary turn" }] }],
		};
		const entries = toTranscript(view, {});
		expect(entries[0]?.kind === "user" ? entries[0].action : undefined).toBeUndefined();
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

	test("a scope's defaults map to picker values, and an empty layer stays empty", () => {
		expect(
			toScopeDefaults({
				model: { provider: "opencode-go", modelId: "deepseek-v4.1-flash" },
				thinking: "max",
				agent: "researcher",
			}),
		).toEqual({
			model: "opencode-go/deepseek-v4.1-flash",
			thinking: "max",
			agent: "researcher",
		});
		// Saying nothing is not the same as agreeing with the layer below.
		expect(toScopeDefaults({})).toEqual({ model: "", thinking: "", agent: "" });
		expect(toScopeDefaults(undefined)).toEqual({ model: "", thinking: "", agent: "" });
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

describe("thinking and silence", () => {
	test("reasoning blocks become their own card, ahead of the reply", () => {
		const view: WireView = {
			entries: [
				{
					id: 1,
					kind: "pi.assistant",
					model: [
						{
							content: [
								{ type: "thinking", thinking: "check the lock order first" },
								{ type: "text", text: "On it." },
							],
						},
					],
				},
			],
		};
		const entries = toTranscript(view, {});
		expect(entries).toHaveLength(2);
		const [thinking, reply] = entries;
		if (thinking?.kind !== "thinking" || reply?.kind !== "assistant")
			throw new Error("expected a thinking card before the reply");
		expect(thinking.text).toBe("check the lock order first");
		expect(thinking.live).toBeUndefined();
		expect(reply.markdown).toBe("On it.");
	});

	test("a redacted block renders as the fact of hiding", () => {
		const view: WireView = {
			entries: [
				{
					id: 1,
					kind: "pi.assistant",
					model: [{ content: [{ type: "thinking", redacted: true }] }],
				},
			],
		};
		const [thinking] = toTranscript(view, {});
		if (thinking?.kind !== "thinking") throw new Error("expected a thinking card");
		expect(thinking.text).toBe("Hidden by safety filters.");
	});

	test("a run with no visible evidence yet gets the dots, and only then", () => {
		const view: WireView = { entries: [] };
		const silent = toTranscript(view, {}, true);
		expect(silent).toHaveLength(1);
		const [dots] = silent;
		if (dots?.kind !== "assistant") throw new Error("expected the dots pane");
		expect(dots.live).toBe(true);
		expect(dots.markdown).toBe("");
		// Idle stays empty, and evidence needs no dots.
		expect(toTranscript(view, {})).toHaveLength(0);
		const streaming: WireView = {
			entries: [],
			docs: { "pi.live": { generation: { message: { content: "On it" } } } },
		};
		expect(
			toTranscript(streaming, {}, true).filter((entry) => entry.id === "live"),
		).toHaveLength(1);
	});
});

describe("pins that outlived what they name", () => {
	const state = (over: Partial<WireState> = {}): WireState =>
		({
			agent: {
				provider: "opencode-go",
				modelId: "deepseek-v4.1-flash",
				thinkingLevel: "max",
			},
			providers: [
				{
					id: "opencode-go",
					name: "opencode-go",
					authenticated: true,
					models: [{ id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash" }],
				},
			],
			agents: [{ name: "researcher" }],
			...over,
		}) as WireState;

	test("a pinned model that the provider still offers is not stale", () => {
		expect(stalePins(state())).toEqual({ model: false, agent: false });
	});

	test("a pinned model that went away is stale, and so is one whose provider is not connected", () => {
		expect(
			stalePins(state({ agent: { provider: "opencode-go", modelId: "gone" } })).model,
		).toBe(true);
		const disconnected = state({
			providers: [
				{ id: "opencode-go", name: "opencode-go", authenticated: false, models: [] },
			],
		});
		expect(stalePins(disconnected).model).toBe(true);
	});

	test("a conversation that never pinned a model is inheriting, not stale", () => {
		expect(stalePins(state({ agent: { provider: "", modelId: "" } })).model).toBe(false);
	});

	test("a pinned definition that was deleted is stale; one that exists is not", () => {
		expect(
			stalePins(state({ agent: { provider: "", modelId: "", definition: "gone" } })).agent,
		).toBe(true);
		expect(
			stalePins(state({ agent: { provider: "", modelId: "", definition: "researcher" } }))
				.agent,
		).toBe(false);
		expect(stalePins(state()).agent).toBe(false);
	});
});

describe("the provider list", () => {
	const provider = (over: Partial<WireProvider> = {}): WireProvider => ({
		id: "opencode-go",
		name: "OpenCode Go",
		authenticated: false,
		models: [],
		...over,
	});

	test("connected rows lead, the rest follow by name", () => {
		const rows = toProviders([
			provider({ id: "b", name: "B" }),
			provider({ id: "a", name: "A", authenticated: true }),
			provider({ id: "c", name: "C" }),
		]);
		expect(rows.map((row) => row.id)).toEqual(["a", "b", "c"]);
	});

	test("auth methods and model counts pass through; absent methods are ambient-only", () => {
		const rows = toProviders([
			provider({
				authenticated: true,
				source: "OPENCODE_API_KEY",
				authType: "api_key",
				authTypes: ["api_key", "oauth"],
				models: [
					{ id: "m1", name: "M1", thinkingLevels: [] },
					{ id: "m2", name: "M2", thinkingLevels: [] },
				],
			}),
		]);
		expect(rows[0]?.modelCount).toBe(2);
		expect(rows[0]?.source).toBe("OPENCODE_API_KEY");
		expect(rows[0]?.authTypes).toEqual(["api_key", "oauth"]);
		expect(toProviders([provider()])[0]?.authTypes).toEqual([]);
	});
});
