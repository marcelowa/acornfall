/**
 * Delegation: one conversation handing work to another conversation.
 *
 * A subagent is not a special kind of thing, it is a conversation with an owner.
 * Ownership decides lifetime — the owner waits for it, its abort reaches it, and it
 * stays out of the rail — while the delegated agent, model, and thinking level are
 * resolved through the same overlay as everything else.
 *
 * Two tools, because there are two shapes of delegation:
 *
 * - `delegate` is a function call: create a child, wait, return its answer.
 * - `subagent` is a relationship: start one that keeps working while you answer, and
 *   whose answer arrives later as a new message. The durable machinery for that is in
 *   delegation-tasks.ts; this file is the model-facing surface and the policy.
 */
import type { Context } from "@earendil-works/chord";
import { Type } from "@earendil-works/pi-ai";
import {
	type Conversation,
	type ConversationId,
	configure,
	defineExtension,
	defineTool,
	type Extension,
	type Harness,
	LiveDoc,
	type Storage,
	UsageDoc,
} from "@earendil-works/pi-durable";
import { resolveAgent, type Catalog, type Delegation, type ResolvedAgent } from "./config.ts";
import { ConversationMetaDoc, conversationIdOf } from "./meta.ts";
import { Anchor, DelegationDoc, reporterTask } from "./delegation-tasks.ts";

const ANSWER_SCAN_LIMIT = 8;
const MAX_DEPTH_WALK = 16;
const READ_LIMIT = 24;
const READ_CHARS = 4000;

export interface DelegationDeps {
	harness: Harness;
	storage: Storage;
	/** Resolved on demand: the catalog is reloaded when definition files change. */
	catalog: () => Catalog;
}

/** The definition a conversation runs, from its own committed metadata. */
async function definitionOf(deps: DelegationDeps, conversationId: string, context: Context): Promise<string | undefined> {
	const meta = await deps.harness.snapshot(ConversationMetaDoc, conversationIdOf(conversationId), context);
	return meta?.definition === undefined || meta.definition === "" ? undefined : meta.definition;
}

/** How many ownership edges separate a conversation from a top-level one. */
export async function depthOf(deps: DelegationDeps, conversationId: string, context: Context): Promise<number> {
	let depth = 0;
	let record = await deps.storage.conversation(conversationIdOf(conversationId), context);
	while (record?.owner !== undefined) {
		depth += 1;
		if (depth > MAX_DEPTH_WALK) break;
		record = await deps.storage.conversation(record.owner.conversationId, context);
	}
	return depth;
}

export interface PolicyView {
	delegation: Delegation;
	depth: number;
	children: number;
	/** Whether delegation would be allowed right now, and why not when it would not. */
	canSpawn: boolean;
	blockedBy?: string;
}

/**
 * What a conversation may do with other conversations. Resolved like its agent, so an
 * install default, a workspace default, and a definition all apply, and the depth rule
 * is what keeps a hierarchy from growing: a conversation at depth `maxDepth` may not
 * create children, while creating peers is a separate permission.
 */
export async function policyFor(deps: DelegationDeps, conversationId: string, context: Context): Promise<PolicyView> {
	const [definition, depth, meta] = await Promise.all([
		definitionOf(deps, conversationId, context),
		depthOf(deps, conversationId, context),
		deps.harness.snapshot(ConversationMetaDoc, conversationIdOf(conversationId), context),
	]);
	const resolved: ResolvedAgent = resolveAgent(deps.catalog(), definition);
	const children = (meta?.children ?? []).length;
	const policy = resolved.delegation;

	let blockedBy: string | undefined;
	if (!policy.spawn) blockedBy = `agent "${resolved.name}" does not allow delegation`;
	else if (depth >= policy.maxDepth) blockedBy = `depth ${depth} of max-depth ${policy.maxDepth}`;
	else if (children >= policy.maxChildren) blockedBy = `${children} children of max-children ${policy.maxChildren}`;

	return {
		delegation: policy,
		depth,
		children,
		canSpawn: blockedBy === undefined,
		...(blockedBy === undefined ? {} : { blockedBy }),
	};
}

/** The newest assistant reply, which is what foreground delegation returns. */
async function answerFrom(conversation: Conversation, context: Context): Promise<string> {
	const page = await conversation.entries({}, ANSWER_SCAN_LIMIT, undefined, context);
	for (const entry of page.items) {
		if (entry.kind !== "pi.assistant") continue;
		const text = entryText(entry);
		if (text.trim() !== "") return text;
	}
	return "";
}

/** One entry's text, with tool calls marked, for reading a transcript in a tool result. */
function entryText(entry: { kind?: string; model?: readonly unknown[] }): string {
	const message = (entry.model ?? [])[0] as { content?: unknown } | undefined;
	if (message === undefined) return "";
	if (typeof message.content === "string") return message.content;
	if (!Array.isArray(message.content)) return "";
	return message.content
		.flatMap((block) => {
			if (typeof block !== "object" || block === null) return [];
			const typed = block as { type?: string; text?: string; name?: string };
			if (typed.type === "text") return [typed.text ?? ""];
			if (typed.type === "toolCall") return [`[called ${typed.name ?? "a tool"}]`];
			return [];
		})
		.join(" ");
}

function splitModel(value: string): { provider: string; modelId: string } {
	const [provider, modelId, ...rest] = value.split("/");
	if (provider === undefined || modelId === undefined || rest.length > 0 || provider === "" || modelId === "") {
		throw new Error(`model must be provider/modelId, got ${value}`);
	}
	return { provider, modelId };
}

export function delegationExtension(deps: DelegationDeps) {
	// Assigned just below, and read by the tools when they create a child: a child is
	// denied these extensions, so it cannot delegate even if the depth rule changes.
	let self: Extension | undefined;

	const subagentTool = defineTool({
		name: "subagent",
		description: [
			"Work with persistent background subagents: conversations that keep working while you answer,",
			"and whose answers arrive later as new messages.",
			"spawn (name, message) starts one; send (name, message) gives an existing one more work;",
			"list shows names, ids, and whether each is working; read shows a subagent's recent transcript;",
			"stop aborts what it is doing now.",
		].join(" "),
		parameters: Type.Object({
			action: Type.Union([
				Type.Literal("spawn"),
				Type.Literal("send"),
				Type.Literal("list"),
				Type.Literal("read"),
				Type.Literal("stop"),
			]),
			name: Type.Optional(Type.String({ description: "The subagent's name" })),
			message: Type.Optional(Type.String({ description: "What to tell it, for spawn and send" })),
			followUp: Type.Optional(
				Type.Boolean({ description: "Queue after its current answer instead of steering it now" }),
			),
			agent: Type.Optional(Type.String({ description: "Agent definition to run it as, for spawn" })),
			model: Type.Optional(Type.String({ description: "provider/modelId override, for spawn" })),
			thinking: Type.Optional(Type.String({ description: "Thinking level override, for spawn" })),
		}),
		// Repeating `stop` could stop newer work, so an interrupted call is not rerun.
		replay: "unsafe",
		execute: async (args, api, context) => {
			const parentId = String(api.conversationId);
			const reply = (text: string, conversationId?: string) => ({
				content: [{ type: "text" as const, text }],
				...(conversationId === undefined || args.name === undefined
					? {}
					: { details: { name: args.name, conversationId } }),
			});

			const snapshot = await api.snapshot(DelegationDoc, api.conversationId, context);
			const state = snapshot ?? { agents: {}, reporters: {}, wakes: 0 };
			const known = args.name === undefined ? undefined : state.agents[args.name];

			if (args.action === "list") {
				const names = Object.keys(state.agents);
				if (names.length === 0) return reply("No subagents.");
				const lines: string[] = [];
				for (const name of names) {
					const entry = state.agents[name]!;
					const [live, usage] = await Promise.all([
						deps.harness.snapshot(LiveDoc, entry.conversationId, context).catch(() => undefined),
						deps.harness.snapshot(UsageDoc, entry.conversationId, context).catch(() => undefined),
					]);
					const tokens = Object.values(usage?.models ?? {}).reduce(
						(sum, item) => sum + (item.totalTokens ?? 0),
						0,
					);
					lines.push(
						`${name}: ${live?.run === undefined ? "idle" : "working"} · conversation ${String(entry.conversationId)} · ${tokens} tokens`,
					);
				}
				return reply(lines.join("\n"));
			}
			if (args.name === undefined) return reply(`${args.action} needs a name.`);
			if (args.action !== "spawn" && known === undefined) return reply(`No subagent named ${args.name}.`);

			if (args.action === "stop") {
				const handle = await api.conversation(known!.conversationId, context);
				await handle!.abort(context);
				return reply(`Stopped ${args.name}.`, String(known!.conversationId));
			}

			if (args.action === "read") {
				const child = await deps.harness.conversation(known!.conversationId, context);
				const page = await child!.entries({}, READ_LIMIT, undefined, context);
				const lines: string[] = [];
				let budget = READ_CHARS;
				for (const entry of [...page.items].reverse()) {
					const text = entryText(entry);
					if (text.trim() === "") continue;
					const trimmed = text.length > budget ? `${text.slice(0, Math.max(budget, 0))}…` : text;
					budget -= trimmed.length;
					lines.push(`${String(entry.kind).replace("pi.", "")}: ${trimmed}`);
					if (budget <= 0) break;
				}
				return reply(lines.join("\n") || "Its transcript is empty.", String(known!.conversationId));
			}

			if (args.message === undefined) return reply(`${args.action} needs a message.`);
			const policy = await policyFor(deps, parentId, context);
			if (args.action === "spawn" && !policy.canSpawn) {
				return reply(`Cannot start a subagent here: ${policy.blockedBy}. Do the work yourself and say why.`);
			}

			// Captured as locals because the closures below outlive TypeScript's
			// narrowing of the optional parameters.
			const name: string = args.name;
			const message: string = args.message;

			const outcome = await api.commit(async (tx) => {
				const current = await tx.doc(DelegationDoc, api.conversationId);
				if (args.action === "spawn" && Object.hasOwn(current.agents, name)) {
					return { text: `${name} already exists; use send.` };
				}
				// Both tasks belong to this conversation and are background, so your Esc
				// and this conversation's idle waits leave them alone.
				const background = { ownership: { kind: "conversation" }, background: true } as const;

				let conversationId: ConversationId;
				if (args.action === "spawn") {
					const anchor = await tx.createTask(Anchor, null, background);
					const child = await tx.createConversation({ ownership: { kind: "task", taskId: anchor } });
					conversationId = child.id;

					const override = {
						...(args.model === undefined ? {} : { model: splitModel(args.model) }),
						...(args.thinking === undefined ? {} : { thinkingLevel: args.thinking as never }),
					};
					const resolved = args.agent === undefined ? undefined : resolveAgent(deps.catalog(), args.agent);
					await configure(tx, child.id, {
						...override,
						...(resolved?.model === undefined ? {} : { model: splitModel(resolved.model) }),
						// A subagent is told what it is, not that it is the parent. Inheriting
						// the parent's instructions would have it introducing itself as the
						// assistant and treating the parent's rules as its own.
						instructions: [
							resolved?.instructions ?? "",
							`You are the subagent "${args.name}". Another conversation started you; answer its requests directly, and say what you did.`,
						]
							.filter((part) => part.trim() !== "")
							.join("\n\n"),
						// Denied outright as well as depth-limited, so it cannot recurse.
						...(self === undefined ? {} : { extensions: { remove: [self] } }),
					});
					current.agents[name] = { conversationId: child.id, reported: [] };
					const meta = await tx.doc(ConversationMetaDoc, child.id);
					meta.definition = args.agent ?? (await definitionOf(deps, parentId, context)) ?? "";
				} else {
					conversationId = known!.conversationId;
				}

				current.reporters[api.taskId] = await tx.createTask(
					reporterTask(deps),
					{
						name,
						conversationId,
						message,
						followUp: args.action === "send" && args.followUp === true,
					},
					background,
				);
				return {
					text:
						args.action === "send"
							? `Sent to ${name}. Its answer will come back to you.`
							: `Started ${name}. Its answer will come back to you.`,
					conversationId: String(conversationId),
				};
			}, context);

			return reply(outcome.text, outcome.conversationId);
		},
	});

	const delegateTool = defineTool({
		name: "delegate",
		description: [
			"Hand a task to a subagent and wait for its answer, all in one call.",
			"Use it when you need the result before you can continue; use the subagent tool when you",
			"would rather keep working while it does. It shares this working directory, so do not",
			"delegate edits to files you are editing yourself.",
		].join(" "),
		parameters: Type.Object({
			task: Type.String({ description: "A complete, self-contained instruction for the subagent" }),
			agent: Type.Optional(Type.String({ description: "Agent definition name to run as" })),
		}),
		// A rerun after a crash finds the child it already made, because the ownership
		// index is committed in the same commit that creates it.
		replay: "safe",
		execute: async (args, api, context) => {
			const parentId = String(api.conversationId);
			const policy = await policyFor(deps, parentId, context);
			if (!policy.canSpawn) {
				return {
					content: [
						{
							type: "text" as const,
							text: `Cannot delegate from here: ${policy.blockedBy}. Do the work yourself and say why.`,
						},
					],
				};
			}

			const childId = await api.commit(async (tx) => {
				const existing = (await tx.scanConversations({ ownerTaskId: api.taskId }, 1)).items[0];
				if (existing !== undefined) return existing.id;

				const created = await tx.createConversation({ ownership: { kind: "task", taskId: api.taskId } });
				if (args.agent !== undefined) {
					// A named agent replaces the inherited instructions rather than stacking
					// on them, or the child would be told it is both.
					const resolved = resolveAgent(deps.catalog(), args.agent);
					await configure(tx, created.id, {
						...(resolved.model === undefined ? {} : { model: splitModel(resolved.model) }),
						...(resolved.thinking === undefined ? {} : { thinkingLevel: resolved.thinking as never }),
						instructions: resolved.instructions,
					});
				}
				const childMeta = await tx.doc(ConversationMetaDoc, created.id);
				childMeta.definition = args.agent ?? (await definitionOf(deps, parentId, context)) ?? "";
				const parentMeta = await tx.doc(ConversationMetaDoc, conversationIdOf(parentId));
				parentMeta.children = [...(parentMeta.children ?? []), String(created.id)];
				return created.id;
			}, context);

			const handle = await api.conversation(childId as ConversationId, context);
			if (handle === undefined) {
				return { content: [{ type: "text" as const, text: "The subagent conversation vanished." }] };
			}
			const submission = await handle.submit(
				{ type: "input", content: args.task, requestId: `acornfall:delegate:${api.taskId}` },
				context,
			);
			const settled = await submission.wait(context);

			const child = await deps.harness.conversation(childId as ConversationId, context);
			const answer = child === undefined ? "" : await answerFrom(child, context);
			await api.details({ conversationId: String(childId), status: settled.status }, context);
			return {
				content: [
					{
						type: "text" as const,
						text:
							answer.trim() === ""
								? `The subagent finished (${settled.status}) without an answer. Its conversation is ${String(childId)}.`
								: answer,
					},
				],
			};
		},
	});

	self = defineExtension({
		name: "acornfall-delegation",
		// The task definitions ship with the extension, so pending reporters resume
		// after a restart as soon as it is installed again.
		tasks: [Anchor, reporterTask(deps)],
		tools: [subagentTool, delegateTool],
	});
	return self;
}
