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
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { getSupportedThinkingLevels } from "@earendil-works/pi-ai/models";
import type { ImageContent, TextContent, UserMessage } from "@earendil-works/pi-ai";
import {
	AgentDoc,
	type Conversation,
	type Cursor,
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
import { openNodeSqliteStorage } from "@earendil-works/pi-durable/storage/sqlite/node";
import { CodingTools } from "@earendil-works/pi-durable/tools";
import { builtinModels } from "@earendil-works/pi-ai/providers/all";
import { FileCredentialStore } from "./credentials.ts";
import {
	ATTACHMENTS_DIR,
	INLINE_TEXT_MAX_BYTES,
	MAX_ATTACHMENTS_PER_MESSAGE,
	MAX_ATTACHMENTS_TOTAL_BYTES,
	MAX_ATTACHMENT_BYTES,
	attachmentLine,
	formatAttachmentSize,
	kindName,
	metaName,
	safeName,
	partMime,
	shapeFor,
	storedName,
	type AttachmentMeta,
} from "./attachments.ts";
import { thinkingLevelFor } from "./thinking.ts";
import { totalCost, totalTokens } from "./usage.ts";
import { cancelAuth, login, resolveAuthAnswer } from "./auth.ts";
import {
	COMMAND_DIRS,
	layerRoots,
	loadCatalog,
	resourceFolders,
	resolveAgent,
	type Catalog,
	type ResolvedAgent,
} from "./config.ts";
import { devProvider, scriptedDevProvider } from "./devprovider.ts";
import { installId } from "./install.ts";
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
import { routingFiles } from "./files.ts";
import { refusedSandbox, type SandboxClient, type SandboxEngine } from "./sandbox.ts";
import { SandboxExecutionEnv } from "./sandbox-env.ts";
import {
	expandCommand,
	foldNotice,
	loadCommands,
	parseCommandInvocation,
	unshadowedBuiltins,
	type Command as SlashCommand,
} from "./commands.ts";

const CONTEXT = BACKGROUND_CONTEXT;
const TITLE_SCAN_LIMIT = 20;
const TITLE_MAX = 64;

const PREAMBLE = [
	"You are Acornfall, a personal assistant with tools.",
	"Work in the workspace directory given below. Prefer reading before editing.",
	"Use the skill tool when a task matches one of the available skills.",
	"Answer in the shape that fits: `> [!WARNING]` for a risk, `- [x]` for a plan, a table for numbers, a `mermaid` fence for a flow. A visual form beats a paragraph when it carries the same meaning.",
	"Be concise, and say what you did, not what you intend to do.",
].join("\n");

interface Args {
	workspace: string;
	/** The installation folder: global resources and shared state. */
	home: string;
	storage: string;
	credentials: string;
	/** The sandbox this workspace runs in, as control named it. Empty means none: tools refuse. */
	sandbox: string;
	/** Which engine that sandbox belongs to. The name is control's, and the two must agree. */
	sandboxEngine: string;
}

function parseArgs(argv: readonly string[]): Args {
	const values = new Map<string, string>();
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg === undefined || !arg.startsWith("--")) continue;
		const key = arg.slice(2);
		const next = argv[index + 1];
		if (next === undefined || next.startsWith("--")) {
			values.set(key, "true");
			continue;
		}
		values.set(key, next);
		index += 1;
	}
	const workspace = resolve(values.get("workspace") ?? process.cwd());
	const defaults = (name: string) => join(workspace, ".acornfall", name);
	const credentials = resolve(values.get("credentials") ?? defaults("credentials.json"));
	const home = resolve(values.get("home") ?? dirname(credentials));
	return {
		workspace,
		home,
		storage: resolve(values.get("storage") ?? defaults("session.sqlite")),
		credentials,
		sandbox: values.get("sandbox") ?? "",
		sandboxEngine: values.get("sandbox-engine") ?? "microsandbox",
	};
}

const args = parseArgs(process.argv.slice(2));
await mkdir(dirname(args.storage), { recursive: true });

const credentials = new FileCredentialStore(args.credentials);
const models = builtinModels({ credentials });

/**
 * The sandbox this workspace runs in — the only way this process touches the workspace.
 *
 * Control created it and named it; this attaches to it with the engine's SDK. There is no
 * fallback to the host: without a sandbox the tools refuse, and a workspace whose resources
 * cannot be read simply has fewer of them. Running unconfined must be a decision somebody
 * made, never a state the system drifted into.
 */
const sandbox: SandboxClient = await openSandboxForWorkspace(args);

async function openSandboxForWorkspace(options: Args): Promise<SandboxClient> {
	if (options.sandbox === "") {
		return refusedSandbox("this workspace has no sandbox: tool execution is disabled");
	}
	const engine = await sandboxEngine(options.sandboxEngine);
	if (engine === undefined) {
		return refusedSandbox(
			`this workspace's sandbox belongs to engine ${options.sandboxEngine}, which this build does not support`,
		);
	}
	return await engine.openSandbox(options.sandbox, options.workspace).catch((error: unknown) => {
		return refusedSandbox(
			`cannot attach to the sandbox ${options.sandbox}: ${error instanceof Error ? error.message : String(error)}`,
		);
	});
}

/** The engine modules this build implements, by the name control sends. */
async function sandboxEngine(name: string): Promise<SandboxEngine | undefined> {
	switch (name) {
		case "microsandbox":
			return await import("./microsandbox.ts");
		case "host":
			return await import("./host.ts");
		default:
			return undefined;
	}
}

// Every resource folder this install reads: the user's, then the workspace's, each with the
// ecosystem's `.agents` before our own `.acornfall`.
//
// The workspace's own files live inside the sandbox and the user's live on the host, so reads
// are routed per path: there is one door to the workspace, and this is it.
const roots = layerRoots({ home: args.home, workspace: args.workspace });
const files = routingFiles(args.workspace, sandbox);
const discoveredSkills = await loadSkills(resourceFolders(roots, ["skills"]), files);

// The overlay, the workspace's rules, and its commands. All reloaded on demand, so
// editing a file does not need a restart.
let catalog: Catalog = await loadCatalog(roots, files);
reportUnknownKeys(catalog);
let workspaceRules = await loadWorkspaceRules();
let commands = await loadCommands(resourceFolders(roots, COMMAND_DIRS), files);

/**
 * The workspace's rules file. It is its own prompt section rather than more
 * `instructions`, so the context inspector can show it and diff it between requests.
 */
async function loadWorkspaceRules(): Promise<string | undefined> {
	const text = (await files.read(join(args.workspace, "AGENTS.md")))?.trim() ?? "";
	return text === "" ? undefined : text;
}

// Skills are filtered per conversation, because two conversations can run
// different agents at once.
const skillFilterByConversation = new Map<string, readonly string[] | null>();

const devScript = process.env.ACORNFALL_DEV_SCRIPT;
if (devScript !== undefined && devScript !== "") {
	const dev = scriptedDevProvider(devScript);
	models.setProvider(dev.provider);
} else if (process.env.ACORNFALL_DEV_PROVIDER === "1") {
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
	skillsExtension(
		discoveredSkills,
		(conversationId) => skillFilterByConversation.get(conversationId) ?? null,
		files,
	),
);
registry.install(CodingTools);

const settings: HarnessSettings = { toolExecution: "parallel" };
// One environment per tool call, all of them over the same sandbox: the id is the sandbox's,
// which is how the harness knows two calls see the same files.
const env = ({ cwd }: { readonly cwd?: string }) =>
	new SandboxExecutionEnv(sandbox, cwd ?? args.workspace);

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
		onReport: (error) =>
			log("extension failure:", error instanceof Error ? error.message : String(error)),
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
registry.install(
	delegationExtension({
		harness,
		storage,
		catalog: () => catalog,
		// What a definition allows, so a child obeys its own list rather than being offered every
		// skill the install has.
		setSkills: (conversationId, skills) =>
			skillFilterByConversation.set(conversationId, skills),
	}),
);
registry.install(
	guardsExtension({ harness, storage, catalog: () => catalog, workspaceRoot: args.workspace }),
);

/** Live handles by conversation id; created on first use. */
const handles = new Map<string, Conversation>();
const subscriptions = new Map<string, { dispose: () => void }>();
const seqs = new Map<string, number>();

function nextSeq(conversationId: string): number {
	const next = (seqs.get(conversationId) ?? 0) + 1;
	seqs.set(conversationId, next);
	return next;
}

/**
 * The active context: which entries the next request would see, and what the
 * last reply read, in provider tokens. Read before a fold, so the note can say
 * what left: the fold buries exactly the entries missing afterwards.
 */
async function activeScope(conversation: Conversation): Promise<{
	entries: { id: EntryId; kind: string }[];
	used: number | undefined;
}> {
	const view = await conversation.context(CONTEXT);
	const entries = view.entries.map((entry) => ({ id: entry.id, kind: entry.kind }));
	let used: number | undefined;
	let usedId = -1;
	for (const entry of view.entries) {
		if (entry.kind !== "pi.assistant") continue;
		const message = entry.model?.[0];
		if (message?.role !== "assistant") continue;
		const tokens = message.usage.input + message.usage.cacheRead;
		if (tokens > 0 && entry.id > usedId) {
			used = tokens;
			usedId = entry.id;
		}
	}
	return { entries, used };
}

/**
 * The model's window, when the conversation named one the catalog knows. Absent
 * otherwise, and the note then reports tokens without a percent.
 */
async function windowOf(conversation: Conversation): Promise<number | undefined> {
	try {
		const agent = await conversation.agent(CONTEXT);
		const ref = agent.model;
		if (ref === undefined) return undefined;
		return models.getModel(ref.provider, ref.modelId)?.contextWindow;
	} catch {
		return undefined;
	}
}

/**
 * The stored files for the ids riding with a message. Refuses rather than
 * skipping: a silently dropped file would answer a question never asked.
 */
async function attachmentFiles(
	ids: readonly string[],
): Promise<{ meta: AttachmentMeta; bytes: Uint8Array }[]> {
	if (ids.length > MAX_ATTACHMENTS_PER_MESSAGE) {
		throw new Error(`one message carries ${MAX_ATTACHMENTS_PER_MESSAGE} files at most`);
	}
	const dir = join(args.workspace, ATTACHMENTS_DIR);
	const found: { meta: AttachmentMeta; bytes: Uint8Array }[] = [];
	let total = 0;
	for (const id of ids) {
		if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) {
			throw new Error("an attachment id is bad; upload the file again");
		}
		const raw = await sandbox.read(join(dir, metaName(id))).catch(() => null);
		if (raw === null) throw new Error("an attachment is gone; upload it again");
		const meta = JSON.parse(raw) as AttachmentMeta;
		const bytes = await sandbox
			.readBytes(join(dir, storedName(meta.id, meta.name)))
			.catch(() => null);
		if (bytes === null) throw new Error("an attachment is gone; upload it again");
		total += bytes.byteLength;
		found.push({ meta: { ...meta, size: bytes.byteLength }, bytes });
	}
	if (total > MAX_ATTACHMENTS_TOTAL_BYTES) {
		throw new Error(
			`one message carries ${MAX_ATTACHMENTS_TOTAL_BYTES / (1024 * 1024)} MB of files at most`,
		);
	}
	return found;
}

/**
 * The user message with files: the text names every attachment, images ride
 * as provider parts, small text rides inline, and the rest rides as a path
 * the tools can read. The names travel in the text, so the transcript shows
 * what rode along without a second channel.
 */
function messageContent(
	text: string,
	files: readonly { meta: AttachmentMeta; bytes: Uint8Array }[],
): UserMessage["content"] {
	if (files.length === 0) return text;
	const header = text.trim() === "" ? [] : [text, ""];
	const blocks: (TextContent | ImageContent)[] = [
		{
			type: "text",
			text: [
				...header,
				...files.map(({ meta }) => attachmentLine(meta)),
				...files.flatMap(({ meta }) =>
					shapeFor(meta.mime, meta.name) === "path"
						? [
								`${meta.name} is a ${kindName(meta.mime)} (${formatAttachmentSize(meta.size)}) at ${ATTACHMENTS_DIR}/${storedName(meta.id, meta.name)}.`,
							]
						: [],
				),
			].join("\n"),
		},
	];
	for (const { meta, bytes } of files) {
		const shape = shapeFor(meta.mime, meta.name);
		if (shape === "image") {
			blocks.push({
				type: "image",
				data: Buffer.from(bytes).toString("base64"),
				mimeType: partMime(meta.mime, meta.name),
			});
		} else if (shape === "text" && bytes.byteLength <= INLINE_TEXT_MAX_BYTES) {
			blocks.push({
				type: "text",
				text: `--- ${meta.name} ---\n${Buffer.from(bytes).toString("utf8")}`,
			});
		}
	}
	return blocks;
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
async function nameOf(
	id: string,
	conversation: Conversation,
): Promise<{ title: string; hidden: boolean }> {
	const meta = await harness.snapshot(ConversationMetaDoc, conversationIdOf(id), CONTEXT);
	const given = meta?.title?.trim() ?? "";
	if (given.length > 0) return { title: given, hidden: meta?.hidden === true };
	const derived = await deriveTitle(conversation);
	if (derived !== "New conversation") {
		// Freeze the first prompt as the name. The scan below is newest-first, so
		// without this the title would follow the latest message instead of the
		// first, renaming the rail row under its reader. A failed freeze is not a
		// failed listing: the derived name still answers this one.
		await setMeta(id, { title: derived }).catch(() => undefined);
	}
	return { title: derived, hidden: meta?.hidden === true };
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
							.filter(
								(block): block is { type: "text"; text: string } =>
									typeof block === "object" &&
									block !== null &&
									(block as { type?: string }).type === "text",
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

/**
 * Last activity is the newest entry's own message timestamp, which is when the
 * conversation last moved. An entry without timestamps carries none, so the
 * conversation keeps rendering flat rather than claiming an activity it never had.
 */
function lastActivityOf(
	entry: { model?: readonly { timestamp?: number }[] } | undefined,
): number | undefined {
	let newest: number | undefined;
	for (const message of entry?.model ?? []) {
		if (typeof message.timestamp !== "number") continue;
		if (newest === undefined || message.timestamp > newest) newest = message.timestamp;
	}
	return newest;
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
			// No catches: a snapshot answers undefined for a document that is not there, so a
			// failure here is a failure, and reading it as idle/0/unnamed is a lie the interface
			// would then show. `conversation.entries` below was always allowed to fail.
			const [live, usage, meta, agentConfig, newest] = await Promise.all([
				harness.snapshot(LiveDoc, conversationIdOf(id), CONTEXT),
				harness.snapshot(UsageDoc, conversationIdOf(id), CONTEXT),
				harness.snapshot(ConversationMetaDoc, conversationIdOf(id), CONTEXT),
				harness.snapshot(AgentDoc, conversationIdOf(id), CONTEXT),
				conversation.entries({}, 1, undefined, CONTEXT),
			]);
			const effectiveModel = agentConfig?.model;
			const effectiveThinking = agentConfig?.thinkingLevel;
			const lastActivity = lastActivityOf(newest.items[0]);
			found.push({
				id,
				title,
				hidden,
				root: record.id === ROOT_CONVERSATION_ID,
				// Read from committed state, so a run that survived a restart still
				// shows as running, and a background run is never invisible.
				running: live?.run !== undefined,
				lastEntryId: String(newest.items[0]?.id ?? ""),
				...(lastActivity === undefined ? {} : { updatedAt: lastActivity }),
				tokens: totalTokens(usage),
				cost: totalCost(usage),
				...(parent === undefined ? {} : { parent }),
				// The stored configuration is the truth for a conversation control does
				// not manage, which is every subagent.
				...(effectiveModel === undefined
					? {}
					: { model: `${effectiveModel.provider}/${effectiveModel.modelId}` }),
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
		// One provider's check failing must not fail the description: the description is how the
		// worker announces itself, so a workspace would be unusable over a provider's bad day.
		// It reports that provider as not authenticated, which is what it also does for no key.
		const check = await models.checkAuth(provider.id).catch(() => undefined);
		const authenticated = check !== undefined;
		const list = authenticated ? await models.getAvailable(provider.id).catch(() => []) : [];
		// What the connect dialog can offer: a key field only when the provider asks for
		// one, sign-in only when it implements it, nothing when the key is ambient.
		const authTypes: DescribeData["providers"][number]["authTypes"] = [];
		if (provider.auth.apiKey?.login !== undefined) authTypes.push("api_key");
		if (provider.auth.oauth !== undefined) authTypes.push("oauth");
		providers.push({
			id: provider.id,
			name: provider.name ?? provider.id,
			authenticated,
			...(check?.source === undefined ? {} : { source: check.source }),
			...(check?.type === undefined ? {} : { authType: check.type }),
			authTypes,
			models: list.map((model) => ({
				id: model.id,
				name: model.name ?? model.id,
				contextWindow: model.contextWindow,
				thinkingLevels: getSupportedThinkingLevels(model) as string[],
			})),
		});
	}
	providers.sort(
		(a, b) => Number(b.authenticated) - Number(a.authenticated) || a.id.localeCompare(b.id),
	);
	return {
		provider: "pi-durable",
		workdir: args.workspace,
		providers,
		// subagents: the delegation tools are installed below, so the interface may offer them.
		capabilities: { steer: true, subagents: true, sandbox: "local-process" },
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

/** Registered tools by name. Unknown names are a config error, not a silent no-op. */
function toolsByName(): Map<string, ToolRegistration> {
	const byName = new Map<string, ToolRegistration>();
	for (const { tool } of registry.snapshot().tools()) byName.set(tool.name, tool);
	return byName;
}

function resolveTool(
	byName: Map<string, ToolRegistration>,
	name: string,
	agent: string,
): ToolRegistration {
	const tool = byName.get(name);
	if (tool === undefined) {
		throw new Error(
			`agent "${agent}" names unknown tool "${name}"; registered: ${[...byName.keys()].join(", ")}`,
		);
	}
	return tool;
}

/**
 * tools: null clears a previous restriction, an array offers exactly those names,
 * and { remove } subtracts. A deny always beats an allow.
 */
function toolFilter(
	resolved: ResolvedAgent,
): readonly ToolRegistration[] | { remove: readonly ToolRegistration[] } | null {
	const byName = toolsByName();
	if (resolved.allowTools !== undefined) {
		return resolved.allowTools.map((name) => resolveTool(byName, name, resolved.name));
	}
	if (resolved.denyTools.length > 0) {
		return {
			remove: resolved.denyTools.map((name) => resolveTool(byName, name, resolved.name)),
		};
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
			log(
				`agent ${agent.name}: unknown frontmatter keys ${agent.unknownKeys.join(", ")} (${agent.source})`,
			);
		}
	}
}

async function main(): Promise<void> {
	harness.resume();
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
		// A login runs beside the queue as well. It is a conversation with the provider that can
		// wait minutes for a code, and one sign-in nobody answers must not hold up every command
		// behind it — the state, the conversations, the next message. Its response still comes
		// when the flow ends, which is what the caller is waiting for.
		if (command.type === "login") {
			void handle(command).then(
				(data) =>
					emit({
						type: "response",
						id: command.id,
						ok: true,
						...(data === undefined ? {} : { data }),
					}),
				(error) =>
					emit({
						type: "response",
						id: command.id,
						ok: false,
						error: (error as Error).message,
					}),
			);
			return;
		}
		queue.push(async () => {
			try {
				const data = await handle(command);
				emit({
					type: "response",
					id: command.id,
					ok: true,
					...(data === undefined ? {} : { data }),
				});
				if (command.type === "shutdown") await shutdown();
			} catch (error) {
				emit({
					type: "response",
					id: command.id,
					ok: false,
					error: (error as Error).message,
				});
			}
		});
	});

	lines.on("close", () => {
		queue.push(shutdown);
	});
}

/**
 * The commands `handle` answers. Login answers are not among them: they arrive while a login
 * is in flight and bypass the queue, because queueing an answer behind the login it answers
 * would deadlock. Saying so in the type is what lets the switch below be exhaustive — a new
 * command in the protocol is then either handled here or added to this exclusion, and the
 * compiler asks.
 */
type HandledCommand = Exclude<Command, { type: "auth_answer" } | { type: "auth_cancel" }>;

async function handle(command: HandledCommand): Promise<unknown> {
	switch (command.type) {
		case "describe":
			return await describe();
		case "conversations":
			return { conversations: await listConversations() };
		case "create": {
			const created = await harness.createConversation(
				{ ownership: { kind: "ownerless" } },
				CONTEXT,
			);
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
			return {
				conversationId: command.conversationId,
				agent: applied.resolved,
				model: applied.model,
			};
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
		case "compact": {
			// Manual compaction: the summary replaces the old prefix while the
			// conversation keeps working, and the transcript keeps a notice.
			const conversation = await conversationFor(command.conversationId);
			await conversation.compact(undefined, CONTEXT);
			return { conversationId: command.conversationId };
		}
		case "compact_preview": {
			// What a manual compaction would fold: entry and turn counts, so the
			// dialog states the scope. The cut itself stays the harness's call.
			const conversation = await conversationFor(command.conversationId);
			let entries = 0;
			let turns = 0;
			let cursor: Cursor | undefined = undefined;
			for (;;) {
				const page = await conversation.entries({}, 200, cursor, CONTEXT);
				for (const entry of page.items) {
					entries += 1;
					if (entry.kind === "pi.user") turns += 1;
				}
				if (page.next === undefined) break;
				cursor = page.next;
			}
			return { conversationId: command.conversationId, entries, turns };
		}
		case "reset": {
			// A fresh context: the reset entry lands and the next turn sees nothing
			// before it. The transcript keeps a notice where the cut was.
			const conversation = await conversationFor(command.conversationId);
			await conversation.reset(undefined, CONTEXT);
			return { conversationId: command.conversationId };
		}
		case "action": {
			// A builtin is visible: the action runs instead of a model turn, then the
			// invocation lands as a user message. The record goes last so a reset
			// cannot bury it before its own cut. A compaction that folds nothing
			// leaves a note, so the send has an answer either way.
			const conversation = await conversationFor(command.conversationId);
			let notice: string | undefined;
			if (command.action === "compact") {
				const before = await activeScope(conversation);
				const contextWindow = await windowOf(conversation);
				const taskId = await conversation.compact(undefined, CONTEXT);
				const settled = await harness.waitForTask(taskId, CONTEXT);
				const outcome = settled.state.outcome;
				if (outcome.status !== "completed") {
					throw new Error(
						outcome.status === "failed" || outcome.status === "faulted"
							? outcome.error.message
							: `compaction ${outcome.status}`,
					);
				}
				const result = outcome.result;
				if (result.entryId === undefined && result.submissionId === undefined) {
					notice = "Nothing to compact — the talk is short.";
				} else {
					// The fold buries exactly the entries missing afterwards: the
					// record and this note land later, so they cannot pollute it.
					const after = await conversation.context(CONTEXT);
					const kept = new Set(after.entries.map((entry) => entry.id));
					const folded = before.entries.filter((entry) => !kept.has(entry.id));
					const foldedTurns = folded.filter((entry) => entry.kind === "pi.user").length;
					notice =
						folded.length === 0
							? "Context compacted into one note."
							: foldNotice(folded.length, foldedTurns, before.used, contextWindow);
				}
			} else {
				await conversation.reset(undefined, CONTEXT);
			}
			const recorded = await conversation.submit(
				{
					type: "write",
					entry: {
						kind: "pi.user",
						model: [{ role: "user", content: command.text, timestamp: Date.now() }],
					},
					requestId: crypto.randomUUID(),
				},
				CONTEXT,
			);
			await recorded.wait(CONTEXT);
			if (notice !== undefined) {
				// Display only: no model messages, so the note never joins the
				// context it just described.
				const noted = await conversation.submit(
					{
						type: "write",
						entry: { kind: "acornfall.notice", data: { text: notice } },
						requestId: crypto.randomUUID(),
					},
					CONTEXT,
				);
				await noted.wait(CONTEXT);
			}
			return { conversationId: command.conversationId };
		}
		case "attach":
			await attach(command.conversationId);
			return {
				conversationId: command.conversationId,
				seq: seqs.get(command.conversationId) ?? 0,
			};
		case "detach":
			subscriptions.get(command.conversationId)?.dispose();
			subscriptions.delete(command.conversationId);
			return undefined;
		case "attachment": {
			// Bytes the gateway staged: the claimed size refuses fast, the read
			// size refuses for real. Stored under the workspace's hidden folder
			// with a generated name, answered with an id. The temp file stays
			// the gateway's to remove; this side only reads it.
			if (command.size > MAX_ATTACHMENT_BYTES) {
				throw new Error(
					`one file carries ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB at most`,
				);
			}
			const bytes = await readFile(command.tempPath).catch(() => {
				throw new Error("the upload did not land; send it again");
			});
			if (bytes.byteLength === 0) throw new Error("empty files carry nothing");
			if (bytes.byteLength > MAX_ATTACHMENT_BYTES) {
				throw new Error(
					`one file carries ${MAX_ATTACHMENT_BYTES / (1024 * 1024)} MB at most`,
				);
			}
			const meta: AttachmentMeta = {
				id: crypto.randomUUID(),
				name: safeName(command.name),
				size: bytes.byteLength,
				mime: command.mime === "" ? "application/octet-stream" : command.mime,
			};
			const dir = join(args.workspace, ATTACHMENTS_DIR);
			await sandbox.mkdir(dir).catch(() => undefined);
			await sandbox.write(join(dir, storedName(meta.id, meta.name)), bytes);
			await sandbox.write(join(dir, metaName(meta.id)), JSON.stringify(meta));
			return { attachment: meta };
		}
		case "prompt": {
			const conversation = await conversationFor(command.conversationId);
			const content = messageContent(
				command.text,
				await attachmentFiles(command.attachments ?? []),
			);
			const submission = await conversation.submit(
				{
					type: "input",
					content,
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
			const state = await harness.snapshot(
				MessagesDoc,
				conversationIdOf(command.conversationId),
				CONTEXT,
			);
			return { conversationId: command.conversationId, state: state ?? null };
		}
		case "policy": {
			const view = await policyFor(
				{ harness, storage, catalog: () => catalog },
				command.conversationId,
				CONTEXT,
			);
			return view;
		}
		case "commands":
			return {
				commands: [
					...commands.map((template) => ({
						name: template.name,
						description: template.description,
						...(template.argumentHint === undefined
							? {}
							: { argumentHint: template.argumentHint }),
						source: template.source,
					})),
					...unshadowedBuiltins(commands).map((builtin) => ({
						name: builtin.name,
						description: builtin.description,
						source: "builtin",
					})),
				],
			};
		case "expand": {
			// A message that opens with /name is a command; anything else is itself, so a
			// message that merely contains a slash is never rewritten.
			const invocation = parseCommandInvocation(command.text);
			if (invocation === undefined) return { text: command.text };
			const template: SlashCommand | undefined = commands.find(
				(candidate) => candidate.name === invocation.name,
			);
			if (template !== undefined) {
				return { text: expandCommand(template, invocation.args), command: template.name };
			}
			// No file: a builtin is an action, not a text, and the gateway runs it
			// instead of sending a turn. A file of the same name wins above.
			const builtin = unshadowedBuiltins(commands).find(
				(candidate) => candidate.name === invocation.name,
			);
			if (builtin === undefined) return { text: command.text };
			return { text: command.text, command: builtin.name, action: builtin.action };
		}
		case "agents":
			return {
				defaults: catalog.defaults,
				skills: discoveredSkills.map((skill) => ({
					name: skill.name,
					description: skill.description,
				})),
				agents: catalog.agents.map((agent) => ({
					name: agent.name,
					description: agent.description,
					source: agent.source,
					layer: agent.layer,
					resolved: resolveAgent(catalog, agent.name),
				})),
			};
		case "reload":
			catalog = await loadCatalog(roots, files);
			reportUnknownKeys(catalog);
			workspaceRules = await loadWorkspaceRules();
			commands = await loadCommands(resourceFolders(roots, COMMAND_DIRS), files);
			return {
				agents: catalog.agents.length,
				commands: commands.length,
				rules: workspaceRules !== undefined,
			};
		case "login":
			return await login(
				models,
				command.authId,
				command.providerId,
				command.authType,
				await installId(args.home),
			);
		case "logout":
			// Removes the stored credential for this provider only.
			await models.logout(command.providerId);
			return { providerId: command.providerId };
		case "usage":
			return await harness.usage(CONTEXT);
		case "shutdown":
			return undefined;
		default: {
			// Unreachable while every member of QueuedCommand has a case above: if one is added
			// without a case, this assignment stops compiling, which is the point.
			const unhandled: never = command;
			throw new Error(`unsupported command: ${JSON.stringify(unhandled)}`);
		}
	}
}

await main();
