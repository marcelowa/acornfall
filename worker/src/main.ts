/**
 * Acornfall harness worker.
 *
 * One worker owns one Harness over one storage: a workspace's sessions and all
 * the subagent conversations they spawn. It speaks the JSONL protocol in
 * src/protocol.ts and never talks to the UI or to our database.
 */
import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import type { ModelThinkingLevel } from "@earendil-works/pi-ai";
import type { Conversation, ToolRegistration } from "@earendil-works/pi-durable";
import {
	createRegistry,
	defineExtension,
	Harness,
	section,
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
import { CommandQueue, type Command, type DescribeData, emit, log } from "./protocol.ts";
import { loadSkills, skillsExtension } from "./skills.ts";

const CONTEXT = BACKGROUND_CONTEXT;

const PREAMBLE = [
	"You are Acornfall, a personal assistant with tools.",
	"Work in the workspace directory given below. Prefer reading before editing.",
	"Use the skill tool when a task matches one of the available skills.",
	"Be concise, and say what you did, not what you intend to do.",
].join("\n");

interface Args {
	workspace: string;
	dataDir: string;
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
		if (key === "skill") {
			skills.push(next);
		} else {
			values.set(key, next);
		}
		index += 1;
	}
	const workspace = resolve(values.get("workspace") ?? process.cwd());
	const defaults = (name: string) => join(workspace, ".acornfall", name);
	const credentials = resolve(values.get("credentials") ?? defaults("credentials.json"));
	return {
		workspace,
		dataDir: resolve(values.get("data-dir") ?? dirname(credentials)),
		storage: resolve(values.get("storage") ?? defaults("session.sqlite")),
		credentials,
		skills: skills.length > 0 ? skills : [join(homedir(), ".acornfall", "skills"), defaults("skills")],
	};
}

const args = parseArgs(process.argv.slice(2));
await mkdir(dirname(args.storage), { recursive: true });

const credentials = new FileCredentialStore(args.credentials);
const models = builtinModels({ credentials });
const discoveredSkills = await loadSkills(args.skills);

// The overlay. Reloaded on demand so editing a definition does not need a restart.
let catalog: Catalog = await loadCatalog(args.dataDir, args.workspace);
let activeAgent: ResolvedAgent = resolveAgent(catalog, undefined);
const activeSkillFilter = (): readonly string[] | null => activeAgent.skills;

// A scripted stand-in provider, so the full path works without an api key.
if (process.env.ACORNFALL_DEV_PROVIDER === "1") {
	const dev = devProvider();
	models.setProvider(dev.provider);
}

const registry = createRegistry();
registry.install(CodingTools);
registry.install(skillsExtension(discoveredSkills, activeSkillFilter));
registry.install(
	defineExtension({
		name: "acornfall-prompt",
		sections: [section("preamble", () => PREAMBLE, { tag: false }), section("cwd", (input) => input.env?.cwd)],
	}),
);

const settings: HarnessSettings = { toolExecution: "parallel" };
const env = ({ cwd }: { readonly cwd?: string }) => new NodeExecutionEnv({ cwd: cwd ?? args.workspace });

const storage = await openNodeSqliteStorage(args.storage);
const harness = await Harness.open(storage, { models, registry, settings, env }, CONTEXT);

const conversationSubscriptions = new Map<string, { dispose: () => void }>();
let seq = 0;

function nextSeq(): number {
	seq += 1;
	return seq;
}

async function describe(): Promise<DescribeData> {	const providers: DescribeData["providers"] = [];
	for (const provider of models.getProviders()) {
		const check = await models.checkAuth(provider.id).catch(() => undefined);
		const authenticated = check !== undefined;
		const modelsForProvider = authenticated
			? await models
					.getAvailable(provider.id)
					.catch(() => [])
					.then((list) => list.map((model) => ({
						id: model.id,
						name: model.name ?? model.id,
						contextWindow: model.contextWindow,
					})))
			: [];
		providers.push({
			id: provider.id,
			name: provider.name ?? provider.id,
			authenticated,
			...(check?.source === undefined ? {} : { source: check.source }),
			models: modelsForProvider,
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
async function bind(conversationId: string, conversation: Conversation): Promise<void> {
	conversationSubscriptions.get(conversationId)?.dispose();
	const view = await conversation.viewState(CONTEXT);
	emit({ type: "view", conversationId, seq: nextSeq(), value: view.value });
	view.subscribe((value) => {
		emit({ type: "view", conversationId, seq: nextSeq(), value });
	});
	conversationSubscriptions.set(conversationId, { dispose: () => view.dispose() });
}

/** One resolved agent application: definition first, explicit choices second. */
async function applyAgent(input: {
	definition?: string | undefined;
	provider: string;
	modelId: string;
	thinkingLevel?: string | undefined;
	instructions?: string | undefined;
}): Promise<{ resolved: ResolvedAgent; model: { provider: string; modelId: string } }> {
	if (root === undefined) throw new Error("worker is not ready");
	const resolved = resolveAgent(catalog, input.definition);
	activeAgent = resolved;

	// An explicit provider/modelId is the user's choice in the picker and beats
	// the definition; the definition beats nothing.
	const fromDefinition = resolved.model?.split("/");
	const provider = input.provider || fromDefinition?.[0] || "";
	const modelId = input.modelId || fromDefinition?.[1] || "";

	const instructions = [resolved.instructions, input.instructions ?? ""]
		.filter((text) => text.trim().length > 0)
		.join("\n\n");

	await root.configure(
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

/** One root conversation per workspace storage in v0. */
let root: Conversation | undefined;

async function main(): Promise<void> {
	await harness.resume();
	root = await harness.root(CONTEXT);
	await bind("root", root);
	log(`worker ready workspace=${args.workspace}`);

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

	// Closing stdin means "finish the queue, then stop". The gateway keeps it open.
	lines.on("close", () => {
		queue.push(shutdown);
	});
}

async function handle(command: Command): Promise<unknown> {
	switch (command.type) {
		case "describe":
			return await describe();
		case "open": {
			if (root === undefined) throw new Error("worker is not ready");
			const applied = await applyAgent({
				definition: command.agent.definition,
				provider: command.agent.provider,
				modelId: command.agent.modelId,
				thinkingLevel: command.agent.thinkingLevel,
				instructions: command.agent.instructions,
			});
			return { conversationId: "root", agent: applied.resolved, model: applied.model };
		}
		case "agents": {
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
		}
		case "reload": {
			catalog = await loadCatalog(args.dataDir, args.workspace);
			return { agents: catalog.agents.length };
		}
		case "attach": {
			if (root === undefined) throw new Error("worker is not ready");
			await bind(command.conversationId, root);
			return { conversationId: command.conversationId, seq };
		}
		case "detach":
			conversationSubscriptions.get(command.conversationId)?.dispose();
			conversationSubscriptions.delete(command.conversationId);
			return undefined;
		case "prompt": {
			if (root === undefined) throw new Error("worker is not ready");
			const submission = await root.submit(
				{
					type: "input",
					content: command.text,
					whenBusy: command.whenBusy ?? "followUp",
					requestId: crypto.randomUUID(),
				},
				CONTEXT,
			);
			void submission
				.wait(CONTEXT)
				.then(
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
			if (root === undefined) throw new Error("worker is not ready");
			await root.abort(CONTEXT);
			return undefined;
		}
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
