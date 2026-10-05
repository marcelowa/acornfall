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
import { Type, type ModelThinkingLevel } from "@earendil-works/pi-ai";
import {
	AgentDoc,
	type Conversation,
	type ConversationId,
	configure,
	defineExtension,
	defineTool,
	type Extension,
	type Harness,
	LiveDoc,
	type Storage,
	type Tx,
	UsageDoc,
} from "@earendil-works/pi-durable";
import { resolveAgent, type Catalog, type Delegation, type ResolvedAgent } from "./config.ts";
import { type ConversationMeta, ConversationMetaDoc, conversationIdOf } from "./meta.ts";
import { Anchor, DelegationDoc, reporterTask } from "./delegation-tasks.ts";
import { log } from "./protocol.ts";
import { thinkingLevelFor } from "./thinking.ts";
import { totalTokens } from "./usage.ts";

const ANSWER_SCAN_LIMIT = 8;
/**
 * How far up an ownership chain to walk before giving up. The chain is acyclic by construction —
 * a task is created in the parent's commit before the conversation it owns — so reaching this
 * means the storage contradicts that, and reporting a depth of 16 beats looping forever.
 */
const MAX_DEPTH_WALK = 16;
const READ_LIMIT = 24;
const READ_CHARS = 4000;

/**
 * What reading a conversation's committed state needs. The rules that only read — resolving a
 * definition, walking ownership, deciding whether one conversation may address another — take
 * this, so the guards can use them without pretending to write anything.
 */
export interface StateDeps {
	harness: Harness;
	storage: Storage;
	/** Resolved on demand: the catalog is reloaded when definition files change. */
	catalog: () => Catalog;
}

export interface DelegationDeps extends StateDeps {
	/**
	 * Records which skills a conversation may load. A child was offered every skill whatever its
	 * definition named, because only the open path set this and a spawn is not an open.
	 */
	setSkills: (conversationId: string, skills: readonly string[] | null) => void;
}

/** The skills a definition allows, or null for every discovered skill. */
function skillsFor(deps: StateDeps, definition: string): readonly string[] | null {
	return definition === "" ? null : resolveAgent(deps.catalog(), definition).skills;
}

/** The definition a conversation runs, from its own committed metadata. */
export async function definitionOf(
	deps: StateDeps,
	conversationId: string,
	context: Context,
): Promise<string | undefined> {
	const meta = await deps.harness.snapshot(ConversationMetaDoc, conversationIdOf(conversationId), context);
	return meta?.definition === undefined || meta.definition === "" ? undefined : meta.definition;
}

/** How many ownership edges separate a conversation from a top-level one. */
export async function depthOf(deps: StateDeps, conversationId: string, context: Context): Promise<number> {
	let depth = 0;
	let record = await deps.storage.conversation(conversationIdOf(conversationId), context);
	while (record?.owner !== undefined) {
		depth += 1;
		if (depth > MAX_DEPTH_WALK) break;
		record = await deps.storage.conversation(record.owner.conversationId, context);
	}
	return depth;
}

/**
 * Whether one conversation may address another. `known` means its own children, the
 * peers it created, and its parent: the conversations it has a reason to know about.
 * Anything else needs `address: any`, which is a deliberate choice for a hub.
 */
export async function mayAddress(
	deps: StateDeps,
	fromId: string,
	targetId: string,
	context: Context,
): Promise<{ allowed: boolean; why: string }> {
	if (fromId === targetId) return { allowed: false, why: "that is this conversation" };
	// A failed read must not read as "no conversation": an unreadable target is not a target
	// that does not exist, and the tool would tell the model the wrong thing.
	const [policy, state, record] = await Promise.all([
		policyFor(deps, fromId, context),
		deps.harness.snapshot(DelegationDoc, conversationIdOf(fromId), context),
		deps.storage.conversation(conversationIdOf(targetId), context),
	]);
	if (record === undefined) return { allowed: false, why: `no conversation ${targetId}` };
	if (policy.delegation.address === "any") return { allowed: true, why: "policy allows any conversation" };
	if (Object.values(state?.agents ?? {}).some((agent) => String(agent.conversationId) === targetId)) {
		return { allowed: true, why: "this conversation created it" };
	}
	// A child, or the conversation this one is working for.
	if (String(record.owner?.conversationId ?? "") === fromId) return { allowed: true, why: "it is a child" };
	const own = await deps.storage.conversation(conversationIdOf(fromId), context);
	if (own?.owner !== undefined && String(own.owner.conversationId) === targetId) {
		return { allowed: true, why: "it is the conversation that started this one" };
	}
	return {
		allowed: false,
		why: `not reachable from here (set address: any in the policy to reach every conversation)`,
	};
}

/**
 * Records a child on the conversation that made it: the definition it runs, and the link back.
 *
 * A peer is ownerless — the rail lists it as a normal conversation — so it records who made it
 * instead of a child link. Returns the child's own document, which a caller adds to when only it
 * knows what else to say: a peer's title, for instance.
 */
async function recordChild(
	deps: StateDeps,
	tx: Tx,
	context: Context,
	options: { parentId: string; childId: ConversationId; definition: string | undefined; owned: boolean },
): Promise<ConversationMeta> {
	const meta = await tx.doc(ConversationMetaDoc, options.childId);
	meta.definition = options.definition ?? (await definitionOf(deps, options.parentId, context)) ?? "";
	if (!options.owned) {
		meta.createdBy = options.parentId;
		return meta;
	}
	const parent = await tx.doc(ConversationMetaDoc, conversationIdOf(options.parentId));
	parent.children = [...(parent.children ?? []), String(options.childId)];
	return meta;
}

/** How many conversations agents have created in this workspace. */
export async function agentCreatedCount(deps: StateDeps, context: Context): Promise<number> {
	let cursor: Parameters<typeof deps.storage.scanConversations>[2];
	let created = 0;
	// Every page: this feeds a ceiling on the whole workspace, and stopping at the first page
	// would stop limiting anything in a workspace with more conversations than one page holds.
	for (;;) {
		const page = await deps.storage.scanConversations({}, 200, cursor, context);
		const metas = await Promise.all(
			page.items.map((record) =>
				deps.harness.snapshot(ConversationMetaDoc, record.id, context).catch((error: unknown) => {
					// Count it rather than skip it: this feeds a ceiling on how many conversations
					// agents may create, and a ceiling that opens when a read fails is not one. The
					// log is what makes the over-count visible instead of silent.
					log(`agentCreatedCount: cannot read ${String(record.id)}; counting it:`, error);
					return { title: "", hidden: false, createdBy: "unreadable" } satisfies ConversationMeta;
				}),
			),
		);
		created += metas.filter((meta) => meta?.createdBy !== undefined && meta.createdBy !== "").length;
		if (page.next === undefined) break;
		cursor = page.next;
	}
	return created;
}

export interface PolicyView {
	delegation: Delegation;
	depth: number;
	children: number;
	/** Conversations agents created in this workspace, against maxPeersTotal. */
	peersTotal: number;
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
export async function policyFor(deps: StateDeps, conversationId: string, context: Context): Promise<PolicyView> {
	const [definition, depth, meta, peersTotal] = await Promise.all([
		definitionOf(deps, conversationId, context),
		depthOf(deps, conversationId, context),
		deps.harness.snapshot(ConversationMetaDoc, conversationIdOf(conversationId), context),
		agentCreatedCount(deps, context),
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
		peersTotal,
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
	// denied these extensions, so it cannot delegate even if the depth rule changes. The
	// tools have to be defined first and the extension needs them, so this is assigned once,
	// after them — which is what `prefer-const` cannot see.
	// eslint-disable-next-line prefer-const -- forward reference from the tools above
	let self: Extension | undefined;

	const subagentTool = defineTool({
		name: "subagent",
		description: [
			"Work with persistent background subagents: conversations that keep working while you answer,",
			"and whose answers arrive later as new messages.",
			"spawn (name, message) starts one; send (name, message) gives an existing conversation more work;",
			"list shows names, ids, and whether each is working; read shows a recent transcript;",
			"stop aborts what it is doing now. An answer to a message you sent comes back to you as a",
			"new message unless you pass fireAndForget.",
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
			conversation: Type.Optional(
				Type.String({ description: "Conversation id, instead of a name, for send, read, and stop" }),
			),
			peer: Type.Optional(
				Type.Boolean({
					description:
						"Create a normal conversation instead of a subagent: it appears in the user's list and outlives you",
				}),
			),
			fireAndForget: Type.Optional(
				Type.Boolean({
					description:
						"Deliver the message, but do not bring its answer back. The conversation still answers in its own transcript; you are just not woken with it. Default: false",
				}),
			),
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
			// A conversation can be addressed by name when it was created here, or by id when it
			// was not, and the policy decides whether the id is reachable at all. What the actions
			// need is the id: the rest of the record is this conversation's own bookkeeping, and
			// inventing one for a target addressed by id would invent a `peer` and a `reported`
			// that are not true of it.
			const target: ConversationId | undefined =
				args.conversation === undefined
					? (args.name === undefined ? undefined : state.agents[args.name])?.conversationId
					: conversationIdOf(args.conversation);
			// The name this conversation knows the target by, when it knows it at all. A target
			// addressed by id is a conversation this one made — the id came from a listing — and
			// the reporter is keyed by that name, so without this the answer has nothing to be
			// reported against and is silently dropped.
			const knownAs =
				args.conversation === undefined
					? undefined
					: Object.entries(state.agents).find(([, entry]) => String(entry.conversationId) === args.conversation)?.[0];
			if (args.conversation !== undefined) {
				const reach = await mayAddress(deps, parentId, args.conversation, context);
				if (!reach.allowed) return reply(`Cannot address ${args.conversation}: ${reach.why}.`);
			}

			if (args.action === "list") {
				const names = Object.keys(state.agents);
				if (names.length === 0) return reply("No subagents.");
				const lines: string[] = [];
				for (const name of names) {
					const entry = state.agents[name]!;
					const [live, usage] = await Promise.all([
						deps.harness.snapshot(LiveDoc, entry.conversationId, context),
						deps.harness.snapshot(UsageDoc, entry.conversationId, context),
					]);
					const tokens = totalTokens(usage);
					lines.push(
						`${name}${entry.peer ? " (peer)" : ""}: ${live?.run === undefined ? "idle" : "working"} · conversation ${String(entry.conversationId)} · ${tokens} tokens`,
					);
				}
				return reply(lines.join("\n"));
			}
			if (args.name === undefined && args.conversation === undefined) {
				return reply(`${args.action} needs a name or a conversation id.`);
			}
			if (args.action !== "spawn" && target === undefined) {
				return reply(`No conversation named ${args.name ?? args.conversation}.`);
			}

			if (args.action === "stop") {
				const handle = await api.conversation(target!, context);
				await handle!.abort(context);
				return reply(`Stopped ${String(target!)}.`, String(target!));
			}

			if (args.action === "read") {
				const child = await deps.harness.conversation(target!, context);
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
				return reply(lines.join("\n") || "Its transcript is empty.", String(target!));
			}

			if (args.message === undefined) return reply(`${args.action} needs a message.`);
			const policy = await policyFor(deps, parentId, context);
			if (args.action === "spawn" && !policy.canSpawn) {
				return reply(`Cannot start a subagent here: ${policy.blockedBy}. Do the work yourself and say why.`);
			}

			// The level is the model's own argument, so an unusable one is answered the way the
			// other refusals here are — as this call's result — rather than thrown past it.
			let overrideLevel: ModelThinkingLevel | null = null;
			if (args.thinking !== undefined) {
				try {
					overrideLevel = thinkingLevelFor(args.thinking);
				} catch (error) {
					return reply((error as Error).message);
				}
			}

			// Captured as locals because the closures below outlive TypeScript's
			// narrowing of the optional parameters. A target addressed by id is labelled with
			// the name it was created under when there is one, and only otherwise with the id.
			const name = args.name ?? knownAs ?? String(target!);
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
					const isPeer = args.peer === true;
					if (isPeer) {
						const peers = Object.values(current.agents).filter((agent) => agent.peer).length;
						if (peers >= policy.delegation.maxPeers) {
							return {
								text: `${name} was not started: this conversation already made ${peers} peers of max-peers ${policy.delegation.maxPeers}.`,
							};
						}
						if (policy.peersTotal >= policy.delegation.maxPeersTotal) {
							return {
								text: `${name} was not started: agents have made ${policy.peersTotal} conversations in this workspace of max-peers-total ${policy.delegation.maxPeersTotal}.`,
							};
						}
						if (!policy.delegation.peers) {
							return { text: "Cannot create a peer here: this agent does not allow peers." };
						}
					}
					// A subagent is owned by an anchor task, so its creator waits for it and
					// its abort reaches it. A peer is ownerless: it appears in the rail and
					// outlives the conversation that made it.
					const child = isPeer
						? await tx.createConversation({ ownership: { kind: "ownerless" } })
						: await tx.createConversation({
								ownership: { kind: "task", taskId: await tx.createTask(Anchor, null, background) },
							});
					conversationId = child.id;

					const override = {
						...(args.model === undefined ? {} : { model: splitModel(args.model) }),
						...(overrideLevel === null ? {} : { thinkingLevel: overrideLevel }),
					};
					const resolved = args.agent === undefined ? undefined : resolveAgent(deps.catalog(), args.agent);
					const resolvedLevel = resolved === undefined ? null : thinkingLevelFor(resolved.thinking);
					const inherited = isPeer ? await tx.doc(AgentDoc, api.conversationId) : undefined;
					// Least specific first, because the last one wins: what this conversation runs,
					// then what the named definition says, then what the caller asked for. That is
					// the order the open path documents — an explicit model beats a definition —
					// and it was the other way round here, so a caller's override lost to the
					// definition and a peer's inherited model beat both.
					await configure(tx, child.id, {
						// An ownerless conversation does not inherit the creator's agent the way a
						// task-owned one does, so a peer copies the model and thinking explicitly.
						...(inherited?.model === undefined ? {} : { model: inherited.model }),
						// A child that recorded no level of its own keeps whatever the copy left it.
						...(inherited?.thinkingLevel === undefined || inherited.thinkingLevel === null
							? {}
							: { thinkingLevel: inherited.thinkingLevel }),
						...(resolved?.model === undefined ? {} : { model: splitModel(resolved.model) }),
						// The definition's level applies here too; it was read and then dropped, so a
						// definition that named one was ignored for every spawned child.
						...(resolvedLevel === null ? {} : { thinkingLevel: resolvedLevel }),
						...override,
						instructions:
							resolved !== undefined
								? resolved.instructions
								: isPeer
									? (inherited?.instructions ?? "")
									: // A subagent is told what it is, not that it is the parent.
										`You are the subagent "${name}". Another conversation started you; answer its requests directly, and say what you did.`,
						// A subagent is denied these tools as well as depth-limited, so it cannot
						// recurse. A peer is a normal conversation, so it keeps them.
						...(isPeer || self === undefined ? {} : { extensions: { remove: [self] } }),
					});
					current.agents[name] = { conversationId: child.id, reported: [], peer: isPeer };
					const meta = await recordChild(deps, tx, context, {
						parentId,
						childId: child.id,
						definition: args.agent,
						owned: isPeer === false,
					});
					deps.setSkills(String(child.id), skillsFor(deps, meta.definition ?? ""));
					if (isPeer) {
						// A peer is a normal conversation, so the rail names it after what it is for.
						meta.title = meta.title === "" ? `Peer: ${name}` : meta.title;
					}
				} else {
					conversationId = target!;
				}

				// One rule, no special cases: an answer to a message you sent comes back to
				// you, whether the conversation you sent it to is a subagent or a peer.
				// Opting out is a single flag, falsy by default.
				// A conversation this one has no record of is not one it can be woken about: the
				// reporter records the answer it delivered against that record, which is what
				// stops a restart from reporting the same answer twice. The reply says so rather
				// than promising a wake that would never come.
				const known = args.action === "spawn" || knownAs !== undefined;
				const wantsReply = !args.fireAndForget && known;
				current.reporters[api.taskId] = await tx.createTask(
					reporterTask(deps),
					{
						name,
						conversationId,
						message,
						followUp: args.action === "send" && args.followUp === true,
						report: wantsReply,
					},
					background,
				);
				const suffix =
					wantsReply
						? " Its answer will come back to you."
						: known
							? ""
							: " It answers in its own transcript; nothing wakes this conversation for it.";
				return {
					text: `${args.action === "send" ? "Sent to" : "Started"} ${name}.${suffix}`,
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

			// A named agent replaces the inherited instructions rather than stacking on them, or
			// the child would be told it is both. Read outside the commit so a definition whose
			// level cannot be used refuses without creating a conversation.
			let definition: ResolvedAgent | undefined;
			let level: ModelThinkingLevel | null = null;
			if (args.agent !== undefined) {
				definition = resolveAgent(deps.catalog(), args.agent);
				try {
					level = thinkingLevelFor(definition.thinking);
				} catch (error) {
					return { content: [{ type: "text" as const, text: (error as Error).message }] };
				}
			}

			const childId = await api.commit(async (tx) => {
				const existing = (await tx.scanConversations({ ownerTaskId: api.taskId }, 1)).items[0];
				if (existing !== undefined) return existing.id;

				const created = await tx.createConversation({ ownership: { kind: "task", taskId: api.taskId } });
				if (definition !== undefined) {
					await configure(tx, created.id, {
						...(definition.model === undefined ? {} : { model: splitModel(definition.model) }),
						...(level === null ? {} : { thinkingLevel: level }),
						instructions: definition.instructions,
					});
				}
				const meta = await recordChild(deps, tx, context, {
					parentId,
					childId: created.id,
					definition: args.agent,
					owned: true,
				});
				deps.setSkills(String(created.id), skillsFor(deps, meta.definition ?? ""));
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
