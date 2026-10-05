/**
 * Acornfall harness worker.
 *
 * One worker owns one Harness over one storage: a workspace's conversations and
 * all the subagent conversations they spawn. It speaks the JSONL protocol in
 * src/protocol.ts and never talks to the UI or to our database.
 *
 * A conversation id is pi-durable's own id, stringified. This layer never invents
 * one; control treats it as opaque.
 */
import { mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai/models";
import {
	AgentDoc,
	type Conversation,
	type EntryId,
	createRegistry,
	defineExtension,
	Harness,
	LiveDoc,
	ROOT_CONVERSATION_ID,
	section,
	UsageDoc,
	type ToolRegistration,
	type HarnessSettings,
} from "@earendil-works/pi-durable";
import { NodeExecutionEnv } from "@earendil-works/pi-durable/env/node";
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { FileCredentialStore } from "./credentials.ts";
import { cancelAuth, login, resolveAuthAnswer } from "./auth.ts";
import { loadCatalog, resolveAgent, type Catalog, type ResolvedAgent } from "./config.ts";
import { devProvider } from "./devprovider.ts";
import { conversationIdOf, ConversationMetaDoc } from "./meta.ts";
import { delegationExtension, policyFor } from "./delegation.ts";
import { guardsExtension } from "./hooks.ts";
import { MessagesDoc } from "./delegation-tasks.ts";
import {
	CommandQueue,
	type Command,
	type ConversationInfo,
	type DescribeData,
	emit,
	log,
} from "./protocol.ts";
import { loadSkills, skillsExtension } from "./skills.ts";
import { expandCommand, loadCommands, parseCommandInvocation, type Command as SlashCommand } from "./commands.ts";

const CONTEXT = BACKGROUND_CONTEXT;
const TITLE_SCAN_LIMIT = 20;
const TITLE_MAX = 64;

const PREAMBLE = [
	"You are Acornfall, a personal assistant with tools.",
	"Work in the workspace directory given below. Prefer reading before editing.",
	"Use the skill tool when a task matches one of the available skills.",
	"Be concise, and say what you did, not what you intend to do.",
].join("\n");

interface Args {
	workspace: string;
	/** The installation folder: global resources and shared state. */
	home: string;
	/** Whether this workspace's own resources may be read at all. */
	trusted: boolean;
	storage: string;
	credentials: string;
	skills: string[];
}

function parseArgs(argv: readonly string[]): Args {
	const values = new Map<string, string>();
	const skills: string[] = [];
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === undefined || !arg.startsWith("--")) continue;
		const key = arg.slice(2);
		const next = argv[index + 1];
		if (next === undefined || next.startsWith("--")) {
			values.set(key, "true");
			continue;
		}
		if (key === "skill") skills.push(next);
		else values.set(key, next);
		index += 1;
	}
	const workspace = resolve(values.get("workspace") ?? process.cwd());
	const defaults = (name: string) => join(workspace, ".acornfall", name);
	const credentials = resolve(values.get("credentials") ?? defaults("credentials.json"));
	const home = resolve(values.get("home") ?? values.get("data-dir") ?? dirname(credentials));
	const trusted = (values.get("trusted") ?? "true") !== "false";
	return {
		workspace,
		home,
		trusted,
		storage: resolve(values.get("storage") ?? defaults("session.sqlite")),
		credentials,
		// An untrusted workspace contributes no skills, so only the global set is read.
		skills:
			skills.length > 0
				? skills
				: [join(home, "skills"), ...(trusted ? [defaults("skills")] : [])],
	};
}

const args = parseArgs(process.argv.slice(2));
await mkdir(dirname(args.storage), { recursive: true });

const credentials = new FileCredentialStore(args.credentials);
const models = builtinModels({ credentials });
const discoveredSkills = await loadSkills(args.skills);

// The overlay, the workspace's rules, and its commands. All reloaded on demand, so
// editing a file does not need a restart.
let catalog: Catalog = await loadCatalog(args.home, args.workspace, args.trusted);
reportUnknownKeys(catalog);
let workspaceRules = await loadWorkspaceRules();
let commands = await loadCommands(commandRoots());

function commandRoots(): string[] {
	return [
		join(args.home, "commands"),
		...(args.trusted ? [join(args.workspace, ".acornfall", "commands")] : []),
	];
}

/**
 * The workspace's rules file. It is its own prompt section rather than more
 * `instructions`, so the context inspector can show it and diff it between requests.
 */
async function loadWorkspaceRules(): Promise<string | undefined> {
	if (!args.trusted) return undefined;
	const source = await readFile(join(args.workspace, "AGENTS.md"), "utf8").catch(() => null);
	const text = source?.trim() ?? "";
	return text === "" ? undefined : text;
}

// Skills are filtered per conversation, because two conversations can run
// different agents at once.
const skillFilterByConversation = new Map<string, readonly string[] | null>();

if (process.env.ACORNFALL_DEV_PROVIDER === "1") {
	const dev = devProvider();
	models.setProvider(dev.provider);
}

const registry = createRegistry();
// Order matters: the prompt reads preamble, where it is, the project's rules, then what
// skills are available, and finally the agent's own instructions, which durable renders.
registry.install(
	defineExtension({
		name: "acornfall-prompt",
		sections: [
			section("preamble", () => PREAMBLE, { tag: false }),
			section("cwd", (input) => input.env?.cwd),
			section("workspace-rules", () => workspaceRules),
		],
	}),
);
registry.install(
	skillsExtension(discoveredSkills, (conversationId) => skillFilterByConversation.get(conversationId) ?? null),
);
registry.install(CodingTools);

const settings: HarnessSettings = { toolExecution: "parallel" };
const env = ({ cwd }: { readonly cwd?: string }) => new NodeExecutionEnv({ cwd: cwd ?? args.workspace });

const storage = await openNodeSqliteStorage(args.storage);
const harness = await Harness.open(
	storage,
	{
		models,
		registry,
		settings,
		env,
		// A task phase that throws is otherwise swallowed: the run simply never
		// continues and nothing is logged. This is the only window into that.
		onReport: (error) => log("extension failure:", error instanceof Error ? error.message : String(error)),
		// Runs in every commit that creates or forks a conversation, so metadata
		// exists from the first entry and a fork inherits its parent's naming rules.
		conversationCreated: async (tx, conversation) => {
			await tx.doc(ConversationMetaDoc, conversation.id);
		},
	},
	CONTEXT,
);

// Registered after the harness opens: the delegation tools need it to read a
// child's answer, and the registry accepts installs while running.
registry.install(delegationExtension({ harness, storage, catalog: () => catalog }));
registry.install(guardsExtension({ harness, storage, catalog: () => catalog, workspaceRoot: args.workspace }));

/** Live handles by conversation id; created on first use. */
const handles = new Map<string, Conversation>();
const subscriptions = new Map<string, { dispose: () => void }>();
const seqs = new Map<string, number>();

function nextSeq(conversationId: string): number {
	const next = (seqs.get(conversationId) ?? 0) + 1;
	seqs.set(conversationId, next);
	return next;
}

async function conversationFor(id: string): Promise<Conversation> {
	const existing = handles.get(id);
	if (existing !== undefined) return existing;
	const handle = await harness.conversation(conversationIdOf(id), CONTEXT);
	if (handle === undefined) throw new Error(`no conversation ${id}`);
	handles.set(id, handle);
	return handle;
}

/** A given name wins; otherwise the first user message is the name. */
async function nameOf(id: string, conversation: Conversation): Promise<{ title: string; hidden: boolean }> {
	const meta = await harness.snapshot(ConversationMetaDoc, conversationIdOf(id), CONTEXT);
	const given = meta?.title?.trim() ?? "";
	return {
		title: given.length > 0 ? given : await deriveTitle(conversation),
		hidden: meta?.hidden === true,
	};
}

async function deriveTitle(conversation: Conversation): Promise<string> {
	const page = await conversation.entries({}, TITLE_SCAN_LIMIT, undefined, CONTEXT);
	for (const entry of page.items) {
		if (entry.kind !== "pi.user") continue;
		const message = (entry.model ?? [])[0] as { content?: unknown } | undefined;
		const text =
			typeof message?.content === "string"
				? message.content
				: Array.isArray(message?.content)
					? message.content
							.filter((block): block is { type: "text"; text: string } =>
								typeof block === "object" && block !== null && (block as { type?: string }).type === "text",
							)
							.map((block) => block.text)
							.join(" ")
					: "";
		const trimmed = text.replace(/\s+/g, " ").trim();
		if (trimmed.length > 0) {
			return trimmed.length > TITLE_MAX ? `${trimmed.slice(0, TITLE_MAX - 1)}…` : trimmed;
		}
	}
	return "New conversation";
}

async function listConversations(): Promise<ConversationInfo[]> {
	const found: ConversationInfo[] = [];
	let cursor: Parameters<typeof storage.scanConversations>[2];
	for (;;) {
		const page = await storage.scanConversations({}, 50, cursor, CONTEXT);
		for (const record of page.items) {
			// Every conversation is listed, including subagent ones. Ownership is
			// reported rather than used as a filter: the rail shows conversations
			// without a parent, and the inspector groups the ones that have one, so
			// hiding them here would leave the UI unable to show them at all.
			const id = String(record.id);
			const conversation = await conversationFor(id);
			const { title, hidden } = await nameOf(id, conversation);
			const owner = record.owner;
			const parent = owner === undefined ? undefined : String(owner.conversationId);
			const [live, usage, meta, agentConfig, newest] = await Promise.all([
				harness.snapshot(LiveDoc, conversationIdOf(id), CONTEXT).catch(() => undefined),
				harness.snapshot(UsageDoc, conversationIdOf(id), CONTEXT).catch(() => undefined),
				harness.snapshot(ConversationMetaDoc, conversationIdOf(id), CONTEXT).catch(() => undefined),
				harness.snapshot(AgentDoc, conversationIdOf(id), CONTEXT).catch(() => undefined),
				conversation.entries({}, 1, undefined, CONTEXT),
			]);
			const effectiveModel = agentConfig?.model;
			const effectiveThinking = agentConfig?.thinkingLevel;
			found.push({
				id,
				title,
				hidden,
				root: record.id === ROOT_CONVERSATION_ID,
				// Read from committed state, so a run that survived a restart still
				// shows as running, and a background run is never invisible.
				running: live?.run !== undefined,
				lastEntryId: String(newest.items[0]?.id ?? ""),
				tokens: totalTokens(usage),
				cost: totalCost(usage),
				...(parent === undefined ? {} : { parent }),
				// The stored configuration is the truth for a conversation control does
				// not manage, which is every subagent.
				...(effectiveModel === undefined ? {} : { model: `${effectiveModel.provider}/${effectiveModel.modelId}` }),
				...(effectiveThinking === undefined ? {} : { thinking: String(effectiveThinking) }),
				...(meta?.createdBy === undefined ? {} : { createdBy: meta.createdBy }),
				...(meta?.children === undefined || meta.children.length === 0
					? {}
					: { children: meta.children }),
			});
		}
		if (page.next === undefined) break;
		cursor = page.next;
	}
	// Newest first; ids are monotonic.
	return found.sort((a, b) => Number(b.id) - Number(a.id));
}

type UsageTotals = { models?: Record<string, { totalTokens?: number; cost?: { total?: number } }> };

function totalTokens(usage: UsageTotals | undefined): number {
	return Object.values(usage?.models ?? {}).reduce((sum, entry) => sum + (entry.totalTokens ?? 0), 0);
}

function totalCost(usage: UsageTotals | undefined): number {
	return Object.values(usage?.models ?? {}).reduce((sum, entry) => sum + (entry.cost?.total ?? 0), 0);
}

/** Writes metadata through the conversation's own commit, so it is durable. */
async function setMeta(id: string, patch: { title?: string; hidden?: boolean }): Promise<void> {
	const conversation = await conversationFor(id);
	await conversation.commit(async (tx) => {
		const meta = await tx.doc(ConversationMetaDoc, conversationIdOf(id));
		if (patch.title !== undefined) meta.title = patch.title;
		if (patch.hidden !== undefined) meta.hidden = patch.hidden;
	}, CONTEXT);
}

async function describe(): Promise<DescribeData> {
	const providers: DescribeData["providers"] = [];
	for (const provider of models.getProviders()) {
		const check = await models.checkAuth(provider.id).catch(() => undefined);
		const authenticated = check !== undefined;
		const list = authenticated
			? await models.getAvailable(provider.id).catch(() => [])
			: [];
		providers.push({
			id: provider.id,
			name: provider.name ?? provider.id,
			authenticated,
			...(check?.source === undefined ? {} : { source: check.source }),
			models: list.map((model) => ({
				id: model.id,
				name: model.name ?? model.id,
				contextWindow: model.contextWindow,
				thinkingLevels: getSupportedThinkingLevels(model) as string[],
			})),
		});
	}
	providers.sort((a, b) => Number(b.authenticated) - Number(a.authenticated) || a.id.localeCompare(b.id));
	return {
		provider: "pi-durable",
		workdir: args.workspace,
		providers,
		capabilities: { steer: true, subagents: false, sandbox: "local-process" },
	};
}

/**
 * View frames, serialized per conversation and carrying our own annotation.
 *
 * The view mounts only durable's documents, so anything of ours the interface needs —
 * here, which user-visible entries were sent by another conversation — travels beside
 * the value. The chain keeps sequence numbers in order when a frame's annotation has to
 * be read asynchronously.
 */
const viewChains = new Map<string, Promise<void>>();
// The last view per conversation, so a change to our own documents can be announced
// without re-reading the view or waiting for durable to commit something it mounts.
const lastViewValue = new Map<string, unknown>();

function enqueueView(conversationId: string, value: unknown): void {
	lastViewValue.set(conversationId, value);
	const previous = viewChains.get(conversationId) ?? Promise.resolve();
	const next = previous.then(async () => {
		const messages = await harness
			.snapshot(MessagesDoc, conversationIdOf(conversationId), CONTEXT)
			.catch((error: unknown) => {
				// Never swallow this: a silent failure here is why attribution looked
				// like it was never recorded.
				log(`senders read failed for ${conversationId}:`, error);
				return undefined;
			});
		const senders = messages?.senders ?? {};
		emit({
			type: "view",
			conversationId,
			seq: nextSeq(conversationId),
			value,
			...(Object.keys(senders).length === 0 ? {} : { acornfall: { senders } }),
		});
	});
	viewChains.set(conversationId, next);
}

async function attach(conversationId: string): Promise<void> {
	const conversation = await conversationFor(conversationId);
	subscriptions.get(conversationId)?.dispose();

	const view = await conversation.viewState(CONTEXT);
	enqueueView(conversationId, view.value);
	view.subscribe((value) => enqueueView(conversationId, value));

	// Durable's view mounts only its own documents, so a commit that writes ours does
	// not advance it and produces no frame. `watchDoc` is the documented way to observe
	// a document of our own; when it changes, the annotation the interface reads has
	// changed with it, so the current view is emitted again.
	const messages = await harness.watchDoc(MessagesDoc, conversationIdOf(conversationId), CONTEXT);
	messages?.start(async () => {
		const current = lastViewValue.get(conversationId);
		if (current !== undefined) enqueueView(conversationId, current);
	});

	subscriptions.set(conversationId, {
		dispose: () => {
			view.dispose();
			void messages?.stop();
		},
	});
}

const THINKING_LEVELS = new Set<ModelThinkingLevel>([
	"off",
	"minimal",
	"low",
	"medium",
	"high",
	"xhigh",
	"max",
]);

/** An unknown level is a config error, not something to pass through to a provider. */
function thinkingLevelFor(value: string | undefined): ModelThinkingLevel | null {
	if (value === undefined || value.length === 0) return null;
	if (!THINKING_LEVELS.has(value as ModelThinkingLevel)) {
		throw new Error(`unknown thinking level "${value}"; expected one of ${[...THINKING_LEVELS].join(", ")}`);
	}
	return value as ModelThinkingLevel;
}

/** Registered tools by name. Unknown names are a config error, not a silent no-op. */
function toolsByName(): Map<string, ToolRegistration> {
	const byName = new Map<string, ToolRegistration>();
	for (const { tool } of registry.snapshot().tools()) byName.set(tool.name, tool);
	return byName;
}

function resolveTool(byName: Map<string, ToolRegistration>, name: string, agent: string): ToolRegistration {
	const tool = byName.get(name);
	if (tool === undefined) {
		throw new Error(`agent "${agent}" names unknown tool "${name}"; registered: ${[...byName.keys()].join(", ")}`);
	}
	return tool;
}

/**
 * tools: null clears a previous restriction, an array offers exactly those names,
 * and { remove } subtracts. A deny always beats an allow.
 */
function toolFilter(resolved: ResolvedAgent): readonly ToolRegistration[] | { remove: readonly ToolRegistration[] } | null {
	const byName = toolsByName();
	if (resolved.allowTools !== undefined) {
		return resolved.allowTools.map((name) => resolveTool(byName, name, resolved.name));
	}
	if (resolved.denyTools.length > 0) {
		return { remove: resolved.denyTools.map((name) => resolveTool(byName, name, resolved.name)) };
	}
	return null;
}

/** One resolved agent application: definition first, explicit choices second. */
async function applyAgent(
	conversationId: string,
	input: {
		definition?: string | undefined;
		provider: string;
		modelId: string;
		thinkingLevel?: string | undefined;
		instructions?: string | undefined;
	},
): Promise<{ resolved: ResolvedAgent; model: { provider: string; modelId: string } }> {
	const conversation = await conversationFor(conversationId);
	const resolved = resolveAgent(catalog, input.definition);
	skillFilterByConversation.set(conversationId, resolved.skills);
	// Written into the conversation, not into control's settings: delegation and
	// the UI both need it, and it belongs with the transcript.
	await conversation.commit(async (tx) => {
		const meta = await tx.doc(ConversationMetaDoc, conversationIdOf(conversationId));
		meta.definition = input.definition ?? "";
	}, CONTEXT);

	// An explicit provider/modelId is the user's choice in the picker and beats
	// the definition; the definition beats nothing.
	const fromDefinition = resolved.model?.split("/");
	const provider = input.provider || fromDefinition?.[0] || "";
	const modelId = input.modelId || fromDefinition?.[1] || "";

	const instructions = [resolved.instructions, input.instructions ?? ""]
		.filter((text) => text.trim().length > 0)
		.join("\n\n");

	await conversation.configure(
		{
			...(provider && modelId ? { model: { provider, modelId } } : {}),
			thinkingLevel: thinkingLevelFor(input.thinkingLevel ?? resolved.thinking),
			instructions,
			tools: toolFilter(resolved),
		},
		CONTEXT,
	);
	return { resolved, model: { provider, modelId } };
}

/** A typo in frontmatter is otherwise indistinguishable from a key that works. */
function reportUnknownKeys(catalog: Catalog): void {
	for (const agent of catalog.agents) {
		if (agent.unknownKeys !== undefined && agent.unknownKeys.length > 0) {
			log(`agent ${agent.name}: unknown frontmatter keys ${agent.unknownKeys.join(", ")} (${agent.source})`);
		}
	}
}

async function main(): Promise<void> {
	await harness.resume();
	// The root conversation exists in every install and is adopted as the first
	// conversation, so an upgrade keeps its history.
	const root = await harness.root(CONTEXT);
	handles.set(String(root.id), root);
	await attach(String(root.id));
	log(`worker ready workspace=${args.workspace} conversation=${root.id}`);

	const queue = new CommandQueue();
	const lines = createInterface({ input: process.stdin, terminal: false });
	let closing = false;

	const shutdown = async (): Promise<void> => {
		if (closing) return;
		closing = true;
		await harness.close(CONTEXT).catch(() => undefined);
		process.exit(0);
	};

	lines.on("line", (line) => {
		const trimmed = line.trim();
		if (trimmed.length === 0) return;
		let command: Command;
		try {
			command = JSON.parse(trimmed) as Command;
		} catch (error) {
			log("dropped unparseable command", error);
			return;
		}
		// Login answers arrive while a login is in flight, so they bypass the queue:
		// queueing them behind the login they answer would deadlock.
		if (command.type === "auth_answer") {
			resolveAuthAnswer(command.promptId, command.value, command.cancelled === true);
			emit({ type: "response", id: command.id, ok: true });
			return;
		}
		if (command.type === "auth_cancel") {
			cancelAuth(command.authId);
			emit({ type: "response", id: command.id, ok: true });
			return;
		}
		queue.push(async () => {
			try {
				const data = await handle(command);
				emit({ type: "response", id: command.id, ok: true, ...(data === undefined ? {} : { data }) });
				if (command.type === "shutdown") await shutdown();
			} catch (error) {
				emit({ type: "response", id: command.id, ok: false, error: (error as Error).message });
			}
		});
	});

	lines.on("close", () => {
		queue.push(shutdown);
	});
}

async function handle(command: Command): Promise<unknown> {
	switch (command.type) {
		case "describe":
			return await describe();
		case "conversations":
			return { conversations: await listConversations() };
		case "create": {
			const created = await harness.createConversation({ ownership: { kind: "ownerless" } }, CONTEXT);
			handles.set(String(created.id), created);
			return { conversationId: String(created.id) };
		}
		case "open": {
			const applied = await applyAgent(command.conversationId, {
				definition: command.agent.definition,
				provider: command.agent.provider,
				modelId: command.agent.modelId,
				thinkingLevel: command.agent.thinkingLevel,
				instructions: command.agent.instructions,
			});
			return { conversationId: command.conversationId, agent: applied.resolved, model: applied.model };
		}
		case "rename": {
			const title = command.title.trim();
			await setMeta(command.conversationId, { title });
			return { conversationId: command.conversationId, title };
		}
		case "hide":
			await setMeta(command.conversationId, { hidden: command.hidden });
			return { conversationId: command.conversationId, hidden: command.hidden };
		case "fork": {
			const conversation = await conversationFor(command.conversationId);
			const forked = await conversation.fork(
				Number(command.at) as EntryId,
				{ ownership: { kind: "ownerless" } },
				CONTEXT,
			);
			handles.set(String(forked.id), forked);
			const parent = await nameOf(command.conversationId, conversation);
			await setMeta(String(forked.id), { title: `Fork of ${parent.title}` });
			return { conversationId: String(forked.id) };
		}
		case "attach":
			await attach(command.conversationId);
			return { conversationId: command.conversationId, seq: seqs.get(command.conversationId) ?? 0 };
		case "detach":
			subscriptions.get(command.conversationId)?.dispose();
			subscriptions.delete(command.conversationId);
			return undefined;
		case "prompt": {
			const conversation = await conversationFor(command.conversationId);
			const submission = await conversation.submit(
				{
					type: "input",
					content: command.text,
					whenBusy: command.whenBusy ?? "followUp",
					requestId: crypto.randomUUID(),
				},
				CONTEXT,
			);
			void submission.wait(CONTEXT).then(
				(settled) =>
					emit({
						type: "submission",
						conversationId: command.conversationId,
						submissionId: String(submission.id),
						status: settled.status,
					}),
				(error: Error) =>
					emit({
						type: "submission",
						conversationId: command.conversationId,
						submissionId: String(submission.id),
						status: `error: ${error.message}`,
					}),
			);
			return { submissionId: String(submission.id), disposition: "started" };
		}
		case "abort": {
			const conversation = await conversationFor(command.conversationId);
			await conversation.abort(CONTEXT);
			return undefined;
		}
		case "messages": {
			const state = await harness.snapshot(MessagesDoc, conversationIdOf(command.conversationId), CONTEXT);
			return { conversationId: command.conversationId, state: state ?? null };
		}
		case "policy": {
			const view = await policyFor({ harness, storage, catalog: () => catalog }, command.conversationId, CONTEXT);
			return view;
		}
		case "commands":
			return {
				commands: commands.map((template) => ({
					name: template.name,
					description: template.description,
					...(template.argumentHint === undefined ? {} : { argumentHint: template.argumentHint }),
					source: template.source,
				})),
			};
		case "expand": {
			// A message that opens with /name is a command; anything else is itself, so a
			// message that merely contains a slash is never rewritten.
			const invocation = parseCommandInvocation(command.text);
			if (invocation === undefined) return { text: command.text };
			const template: SlashCommand | undefined = commands.find((candidate) => candidate.name === invocation.name);
			if (template === undefined) return { text: command.text };
			return { text: expandCommand(template, invocation.args), command: template.name };
		}
		case "agents":
			return {
				defaults: catalog.defaults,
				skills: discoveredSkills.map((skill) => ({ name: skill.name, description: skill.description })),
				agents: catalog.agents.map((agent) => ({
					name: agent.name,
					description: agent.description,
					source: agent.source,
					layer: agent.layer,
					resolved: resolveAgent(catalog, agent.name),
				})),
			};
		case "reload":
			catalog = await loadCatalog(args.home, args.workspace, args.trusted);
			reportUnknownKeys(catalog);
			workspaceRules = await loadWorkspaceRules();
			commands = await loadCommands(commandRoots());
			return { agents: catalog.agents.length, commands: commands.length, rules: workspaceRules !== undefined };
		case "login":
			return await login(models, command.authId, command.providerId, command.authType);
		case "logout":
			// Removes the stored credential for this provider only.
			await models.logout(command.providerId);
			return { providerId: command.providerId };
		case "usage":
			return await harness.usage(CONTEXT);
		case "shutdown":
			return undefined;
		default:
			throw new Error(`unsupported command: ${JSON.stringify(command)}`);
	}
}

await main();
