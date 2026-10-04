/**
 * Delegation: one conversation handing work to another conversation.
 *
 * A subagent is not a special kind of thing, it is a conversation with an owner.
 * Ownership decides lifetime — the owner waits for it, its abort reaches it, and it
 * stays out of the rail — while the delegated agent, model, and thinking level are
 * resolved through the same overlay as everything else.
 *
 * This is the foreground form only: `delegate` blocks until the child answers.
 * Background children and peer creation come later. See docs/adr/0008-delegation.md.
 */
import type { Context } from "@earendil-works/chord";
import { Type } from "@earendil-works/pi-ai";
import {
	type Conversation,
	type ConversationId,
	configure,
	defineExtension,
	defineTool,
	type Harness,
	type Storage,
} from "@earendil-works/pi-durable";
import { resolveAgent, type Catalog, type Delegation, type ResolvedAgent } from "./config.ts";
import { ConversationMetaDoc, conversationIdOf } from "./meta.ts";

const ANSWER_SCAN_LIMIT = 8;
const MAX_DEPTH_WALK = 16;

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
	/** Whether `delegate` would be allowed right now, and why not when it would not. */
	canSpawn: boolean;
	blockedBy?: string;
}

/**
 * What a conversation may do with other conversations. Resolved like its agent, so
 * an install default, a workspace default, and a definition all apply, and the
 * depth rule is what keeps a hierarchy from growing: a conversation at depth
 * `maxDepth` may not create children, while creating peers is a separate permission.
 */
export async function policyFor(
	deps: DelegationDeps,
	conversationId: string,
	context: Context,
): Promise<PolicyView> {
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

/** The newest assistant reply, which is what delegation returns to the parent. */
async function answerFrom(conversation: Conversation, context: Context): Promise<string> {
	const page = await conversation.entries({}, ANSWER_SCAN_LIMIT, undefined, context);
	for (const entry of page.items) {
		if (entry.kind !== "pi.assistant") continue;
		const message = (entry.model ?? [])[0] as { content?: unknown } | undefined;
		if (typeof message?.content === "string" && message.content.trim() !== "") return message.content;
		if (Array.isArray(message?.content)) {
			const text = message.content
				.filter((block): block is { type: "text"; text: string } =>
					typeof block === "object" && block !== null && (block as { type?: string }).type === "text",
				)
				.map((block) => block.text)
				.join("\n");
			if (text.trim() !== "") return text;
		}
	}
	return "";
}

function splitModel(value: string): { provider: string; modelId: string } {
	const [provider, modelId, ...rest] = value.split("/");
	if (provider === undefined || modelId === undefined || rest.length > 0 || provider === "" || modelId === "") {
		throw new Error(`model must be provider/modelId, got ${value}`);
	}
	return { provider, modelId };
}

export function delegationExtension(deps: DelegationDeps) {
	return defineExtension({
		name: "acornfall-delegation",
		tools: [
			defineTool({
				name: "delegate",
				description: [
					"Hand a self-contained task to a subagent conversation and return its answer.",
					"The subagent starts with a copy of your agent, tools, and working directory unless you",
					"name a different agent. Use it for work whose detail would flood your context, not for",
					"work you can finish in one step. It shares this working directory, so do not delegate",
					"edits to files you are editing yourself.",
				].join(" "),
				parameters: Type.Object({
					task: Type.String({ description: "A complete, self-contained instruction for the subagent" }),
					agent: Type.Optional(Type.String({ description: "Agent definition name to run as" })),
					model: Type.Optional(Type.String({ description: "provider/modelId override" })),
					thinking: Type.Optional(Type.String({ description: "Thinking level override" })),
				}),
				// A rerun after a crash finds the child it already made, because the
				// ownership index is committed in the same commit that creates it.
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

					const override = {
						...(args.model === undefined ? {} : { model: splitModel(args.model) }),
						...(args.thinking === undefined ? {} : { thinkingLevel: args.thinking as never }),
					};
					const parentDefinition = await definitionOf(deps, parentId, context);
					const definition = args.agent ?? parentDefinition;

					const childId = await api.commit(async (tx) => {
						const existing = (await tx.scanConversations({ ownerTaskId: api.taskId }, 1)).items[0];
						if (existing !== undefined) return existing.id;

						const created = await tx.createConversation({
							ownership: { kind: "task", taskId: api.taskId },
						});

						if (args.agent !== undefined) {
							// A named agent replaces the inherited instructions rather than
							// stacking on them, or the child would be told it is both.
							const resolved = resolveAgent(deps.catalog(), args.agent);
							await configure(tx, created.id, {
								...override,
								...(resolved.model === undefined ? {} : { model: splitModel(resolved.model) }),
								...(resolved.thinking === undefined ? {} : { thinkingLevel: resolved.thinking as never }),
								instructions: resolved.instructions,
							});
						} else if (Object.keys(override).length > 0) {
							await configure(tx, created.id, override);
						}

						const childMeta = await tx.doc(ConversationMetaDoc, created.id);
						if (definition !== undefined) childMeta.definition = definition;
						const parentMeta = await tx.doc(ConversationMetaDoc, conversationIdOf(parentId));
						parentMeta.children = [...(parentMeta.children ?? []), String(created.id)];
						return created.id;
					}, context);

					const handle = await api.conversation(childId as ConversationId, context);
					if (handle === undefined) {
						return { content: [{ type: "text" as const, text: "The subagent conversation vanished." }] };
					}
					const submission = await handle.submit(
						{ type: "input", content: args.task, requestId: `delegate:${api.taskId}` },
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
			}),
		],
	});
}
