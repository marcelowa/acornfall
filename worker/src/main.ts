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
import type { Conversation } from "@earendil-works/pi-durable";
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
	return {
		workspace,
		storage: resolve(values.get("storage") ?? defaults("session.sqlite")),
		credentials: resolve(values.get("credentials") ?? defaults("credentials.json")),
		skills: skills.length > 0 ? skills : [join(homedir(), ".acornfall", "skills"), defaults("skills")],
	};
}

const args = parseArgs(process.argv.slice(2));
await mkdir(dirname(args.storage), { recursive: true });

const credentials = new FileCredentialStore(args.credentials);
const models = builtinModels({ credentials });
const skills = await loadSkills(args.skills);

// A scripted stand-in provider, so the full path works without an api key.
if (process.env.ACORNFALL_DEV_PROVIDER === "1") {
	const dev = devProvider();
	models.setProvider(dev.provider);
}

const registry = createRegistry();
registry.install(CodingTools);
registry.install(skillsExtension(skills));
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

async function describe(): Promise<DescribeData> {
	const providers: DescribeData["providers"] = [];
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
			const agent: Record<string, unknown> = {
				model: { provider: command.agent.provider, modelId: command.agent.modelId },
			};
			if (command.agent.thinkingLevel !== undefined) agent.thinkingLevel = command.agent.thinkingLevel;
			if (command.agent.instructions !== undefined) agent.instructions = command.agent.instructions;
			await root.configure(agent, CONTEXT);
			return { conversationId: "root" };
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
		case "usage":
			return await harness.usage(CONTEXT);
		case "shutdown":
			return undefined;
		default:
			throw new Error(`unsupported command: ${JSON.stringify(command)}`);
	}
}

await main();
