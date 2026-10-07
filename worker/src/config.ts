/**
 * Agent definitions and the resource overlay.
 *
 * Three layers contribute to one resolved agent:
 *   global    <data-dir>/config.json + <data-dir>/agents/<name>.md
 *   workspace <workspace>/.acornfall/config.json + agents/<name>.md
 *   agent     the definition file itself
 *
 * Resolution is deterministic and explainable: every resolved field records
 * which layer set it. See docs/adr/0004-resource-overlay.md.
 */
import type { Files } from "./files.ts";
import { homedir } from "node:os";
import { join } from "node:path";

export type LayerName = "global" | "workspace" | "agent";

/** Where a definition came from. `built-in` is the general agent, which has no file. */
export type AgentLayer = "global" | "workspace" | "built-in";

/** The agent every conversation has. A `general.md` in any layer replaces it. */
export const GENERAL_AGENT = "general";

/**
 * What a conversation may do with other conversations. Ownership decides lifetime;
 * this decides permission, and the two are separate on purpose.
 *
 * Depth is what stops a hierarchy from growing: a top-level conversation is depth
 * 0 and may create children at depth 1, and a conversation at depth >= maxDepth may
 * not create children at all. Creating peers is not restricted this way, because a
 * peer is not in the ownership chain — which is exactly the requested rule: a child
 * cannot spawn children, but it can make siblings.
 */
export interface Delegation {
	/** May create a conversation it owns, which it can wait for and abort. */
	spawn: boolean;
	/** May create a normal conversation, which appears in the rail and outlives it. */
	peers: boolean;
	maxChildren: number;
	maxDepth: number;
	maxPeers: number;
	/**
	 * How many times a subagent's answer may wake this conversation. The budget that
	 * stops a chain of agents from talking to each other indefinitely.
	 */
	maxWakes: number;
	/**
	 * Which conversations this one may address. "known" is its own children, the peers
	 * it created, and its parent; "any" reaches every conversation in the workspace,
	 * which is what a hub conversation wants and what a leaf should not have.
	 */
	address: "known" | "any";
	/**
	 * How many conversations agents may create in a workspace, in total. Each
	 * conversation is limited by maxPeers, but peers can create peers, so without a
	 * workspace-wide ceiling the graph grows by a factor at every level.
	 */
	maxPeersTotal: number;
}

export const DEFAULT_DELEGATION: Delegation = {
	spawn: true,
	peers: true,
	maxChildren: 4,
	maxDepth: 1,
	maxPeers: 2,
	maxWakes: 12,
	address: "known",
	maxPeersTotal: 8,
};

/**
 * A declarative guard on a tool call. Two matchers, because they are the two that
 * actually matter for an assistant with a shell: do not run this command, and do not
 * write outside the workspace. A guard can only deny, never allow.
 */
export interface Guard {
	/** A tool name, or `*` for every tool. */
	tool: string;
	/** Which argument to test. Explicit, so nothing is matched by surprise. */
	arg: string;
	/** A regular expression the argument must not match. */
	pattern?: string;
	/** The argument is a path, and must resolve inside the workspace. */
	outside?: boolean;
	/** Shown to the model when the call is blocked. */
	reason: string;
}

export interface Contributions {
	model?: string;
	thinking?: string;
	instructions?: string;
	skills?: string[];
	allowTools?: string[];
	denyTools?: string[];
	/** Replaces wholesale: a partially specified policy would be ambiguous. */
	delegation?: Partial<Delegation>;
	/** Guards accumulate across layers: a rule added anywhere holds everywhere. */
	guards?: Guard[];
}

export interface AgentDefinition {
	name: string;
	description: string;
	/** File the definition came from; a workspace file shadows a global one. Empty for the
	 * built-in general agent, which is not a file. */
	source: string;
	layer: AgentLayer;
	contributions: Contributions;
	/** Frontmatter keys this build does not know; reported, never silently ignored. */
	unknownKeys?: readonly string[];
}

export interface LayerTrace {
	layer: LayerName;
	path: string;
	contributes: Contributions;
}

export interface ResolvedAgent {
	delegation: Delegation;
	guards: Guard[];
	name: string;
	description: string;
	source: string;
	model?: string;
	thinking?: string;
	/** Concatenated global, workspace, then agent instructions, in that order. */
	instructions: string;
	/** Names the model may load, or null when every discovered skill is offered. */
	skills: string[] | null;
	/** Names offered, or undefined when every registered tool is offered. */
	allowTools?: string[];
	denyTools: string[];
	layers: LayerTrace[];
}

const KNOWN_KEYS = new Set([
	"name",
	"description",
	"model",
	"thinking",
	"instructions",
	"skills",
	"allow-tools",
	"deny-tools",
	"delegation",
	"max-children",
	"max-depth",
	"max-peers",
	"max-wakes",
	"address",
	"max-peers-total",
]);

/** `delegation: spawn, peers` — a list, so the two permissions read separately. */
function parseDelegation(raw: string): Partial<Delegation> {
	const parts = parseList(raw).map((part) => part.toLowerCase());
	if (parts.includes("none")) return { spawn: false, peers: false };
	const policy: Partial<Delegation> = {};
	if (parts.some((part) => part === "spawn" || part === "both" || part === "all"))
		policy.spawn = true;
	if (
		parts.some(
			(part) => part === "peers" || part === "peer" || part === "both" || part === "all",
		)
	)
		policy.peers = true;
	if (
		!parts.some(
			(part) => part === "spawn" || part === "both" || part === "all" || part === "none",
		)
	)
		policy.spawn = false;
	if (
		!parts.some(
			(part) =>
				part === "peers" ||
				part === "peer" ||
				part === "both" ||
				part === "all" ||
				part === "none",
		)
	) {
		policy.peers = false;
	}
	return policy;
}

/** A guard that cannot be understood is an error, not a rule that quietly does nothing. */
function parseGuard(entry: unknown, path: string): Guard {
	if (typeof entry !== "object" || entry === null)
		throw new Error(`${path}: a guard must be an object`);
	const raw = entry as Record<string, unknown>;
	const tool = typeof raw.tool === "string" ? raw.tool : "";
	const arg = typeof raw.arg === "string" ? raw.arg : "";
	const reason = typeof raw.reason === "string" ? raw.reason : "";
	const pattern = typeof raw.pattern === "string" ? raw.pattern : undefined;
	const outside = raw.outside === true;
	if (tool === "" || arg === "") throw new Error(`${path}: a guard needs a tool and an arg`);
	if (reason === "")
		throw new Error(`${path}: a guard needs a reason, because the model is told it`);
	if (pattern === undefined && !outside) {
		throw new Error(`${path}: a guard needs a pattern or outside: true`);
	}
	if (pattern !== undefined) {
		try {
			new RegExp(pattern);
		} catch (error) {
			throw new Error(`${path}: guard pattern does not compile: ${(error as Error).message}`);
		}
	}
	return {
		tool,
		arg,
		reason,
		...(pattern === undefined ? {} : { pattern }),
		...(outside ? { outside: true } : {}),
	};
}

function parseCount(raw: string, key: string): number {
	const value = Number.parseInt(raw, 10);
	if (!Number.isInteger(value) || value < 0)
		throw new Error(`${key} must be a non-negative integer, got ${raw}`);
	return value;
}

function parseList(raw: string): string[] {
	return raw
		.replace(/^\[|\]$/g, "")
		.split(",")
		.map((item) => item.trim().replace(/^["']|["']$/g, ""))
		.filter((item) => item.length > 0);
}

/** Parses frontmatter into contributions. Unknown keys are reported by the caller. */
function parseFrontmatter(source: string): {
	values: Record<string, string>;
	body: string;
	unknown: string[];
} {
	const values: Record<string, string> = {};
	if (!source.startsWith("---")) return { values, body: source.trim(), unknown: [] };
	const end = source.indexOf("\n---", 3);
	if (end === -1) return { values, body: source.trim(), unknown: [] };
	const unknown: string[] = [];
	for (const rawLine of source.slice(3, end).split("\n")) {
		const line = rawLine.trim();
		if (line.length === 0 || line.startsWith("#")) continue;
		const colon = line.indexOf(":");
		if (colon === -1) continue;
		const key = line.slice(0, colon).trim();
		const value = line.slice(colon + 1).trim();
		if (KNOWN_KEYS.has(key)) values[key] = value;
		else unknown.push(key);
	}
	return { values, body: source.slice(end + 4).trim(), unknown };
}

/** A file may be a config object or a small wrapper around one. */
async function loadConfig(
	files: Files,
	path: string,
	label: LayerName,
): Promise<{ contributions: Contributions; path: string } | null> {
	const text = await files.read(path);
	if (text === null) return null;
	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(text) as Record<string, unknown>;
	} catch (error) {
		throw new Error(
			`${label} config at ${path} is not valid JSON: ${(error as Error).message}`,
		);
	}
	const source = (parsed.defaults ?? parsed) as Record<string, unknown>;
	const contributions: Contributions = {};
	if (typeof source.model === "string") contributions.model = source.model;
	if (typeof source.thinking === "string") contributions.thinking = source.thinking;
	if (typeof source.instructions === "string") contributions.instructions = source.instructions;
	const hooks = (source.hooks ?? {}) as Record<string, unknown>;
	if (Array.isArray(hooks.guards))
		contributions.guards = hooks.guards.map((entry) => parseGuard(entry, path));
	if (source.delegation !== undefined && typeof source.delegation === "object") {
		const raw = source.delegation as Record<string, unknown>;
		const policy: Partial<Delegation> = {};
		if (typeof raw.spawn === "boolean") policy.spawn = raw.spawn;
		if (typeof raw.peers === "boolean") policy.peers = raw.peers;
		if (typeof raw.maxChildren === "number") policy.maxChildren = raw.maxChildren;
		if (typeof raw.maxDepth === "number") policy.maxDepth = raw.maxDepth;
		if (typeof raw.maxPeers === "number") policy.maxPeers = raw.maxPeers;
		if (typeof raw.maxWakes === "number") policy.maxWakes = raw.maxWakes;
		if (raw.address === "known" || raw.address === "any") policy.address = raw.address;
		if (typeof raw.maxPeersTotal === "number") policy.maxPeersTotal = raw.maxPeersTotal;
		contributions.delegation = policy;
	}
	if (Array.isArray(source.skills)) contributions.skills = source.skills.map(String);
	if (Array.isArray(source.allowTools)) contributions.allowTools = source.allowTools.map(String);
	if (Array.isArray(source.denyTools)) contributions.denyTools = source.denyTools.map(String);
	return { contributions, path };
}

async function loadAgentDir(
	files: Files,
	directory: string,
	layer: AgentLayer,
): Promise<AgentDefinition[]> {
	const agents: AgentDefinition[] = [];
	for (const entry of await files.list(directory)) {
		if (entry.directory || !entry.name.endsWith(".md")) continue;
		const path = join(directory, entry.name);
		const source = await files.read(path);
		if (source === null) continue;
		const { values, body, unknown } = parseFrontmatter(source);
		const name = values.name ?? entry.name.replace(/\.md$/, "");
		const contributions: Contributions = {};
		if (values.model !== undefined) contributions.model = values.model;
		if (values.thinking !== undefined) contributions.thinking = values.thinking;
		const instructions = [values.instructions, body].filter(
			(text) => text !== undefined && text.length > 0,
		);
		if (instructions.length > 0) contributions.instructions = instructions.join("\n\n");
		if (values.skills !== undefined) contributions.skills = parseList(values.skills);
		if (values["allow-tools"] !== undefined)
			contributions.allowTools = parseList(values["allow-tools"]);
		if (values["deny-tools"] !== undefined)
			contributions.denyTools = parseList(values["deny-tools"]);
		const delegation: Partial<Delegation> = {};
		if (values.delegation !== undefined)
			Object.assign(delegation, parseDelegation(values.delegation));
		if (values["max-children"] !== undefined)
			delegation.maxChildren = parseCount(values["max-children"], "max-children");
		if (values["max-depth"] !== undefined)
			delegation.maxDepth = parseCount(values["max-depth"], "max-depth");
		if (values["max-peers"] !== undefined)
			delegation.maxPeers = parseCount(values["max-peers"], "max-peers");
		if (values["max-wakes"] !== undefined)
			delegation.maxWakes = parseCount(values["max-wakes"], "max-wakes");
		if (values["max-peers-total"] !== undefined) {
			delegation.maxPeersTotal = parseCount(values["max-peers-total"], "max-peers-total");
		}
		if (values.address !== undefined) {
			const address = values.address.trim().toLowerCase();
			if (address !== "known" && address !== "any") {
				throw new Error(`address must be "known" or "any", got ${values.address}`);
			}
			delegation.address = address;
		}
		if (Object.keys(delegation).length > 0) contributions.delegation = delegation;
		agents.push({
			name,
			description: values.description ?? "",
			source: path,
			layer,
			contributions,
			...(unknown.length > 0 ? { unknownKeys: unknown } : {}),
		});
	}
	return agents;
}

export interface Catalog {
	defaults: LayerTrace[];
	agents: AgentDefinition[];
}

/**
 * The folder names a resource bundle may live under.
 *
 * `.agents` is the rest of the ecosystem's name for it — the Agent Skills convention for
 * `skills/`, and what the other harnesses look for — so a bundle written for one of them
 * works here. `.acornfall` is ours. A folder that has both uses ours: the interchange copy is
 * the one you share, and the local one is the one that overrides it.
 */
const ECOSYSTEM_DIR = ".agents";
const NATIVE_DIR = ".acornfall";

/**
 * The folders one install reads, least specific first: each may hold `config.json`, `agents/`,
 * `skills/`, and `commands/`. Later folders shadow earlier ones, which is how a workspace
 * overrides the install and how the native folder overrides the ecosystem one beside it.
 */
export interface LayerRoots {
	/** The user's: the ecosystem's shared folder first, then the install's own. */
	global: readonly string[];
	/** The workspace's: the ecosystem's folder first, then ours. */
	workspace: readonly string[];
}

export function layerRoots(options: {
	home: string;
	workspace: string;
	/** The user's home directory, for `~/.agents`. Injected so a test never reads the real one. */
	userHome?: string;
}): LayerRoots {
	const user = options.userHome ?? homedir();
	return {
		global: [join(user, ECOSYSTEM_DIR), options.home],
		workspace: [join(options.workspace, ECOSYSTEM_DIR), join(options.workspace, NATIVE_DIR)],
	};
}

/**
 * The folder names a prompt template lives under: ours, and the ecosystem's. Both are read, and
 * ours wins at the same level, so a bundle can carry a copy for each reader — which is the whole
 * point of `.agents/`: the file that is `/deslop` in one tool is `/deslop` in the other.
 */
export const COMMAND_DIRS = ["prompts", "commands"] as const;

/**
 * The folders one resource lives in, per layer root, in order: later folders shadow earlier
 * ones. Within a root that means the ecosystem's name first and ours second, and a workspace
 * still beats the install.
 */
export function resourceFolders(roots: LayerRoots, names: readonly string[]): string[] {
	return [...roots.global, ...roots.workspace].flatMap((root) =>
		names.map((name) => join(root, name)),
	);
}

/**
 * Reads every folder the install has, in order: the user's, then the workspace's.
 *
 * Every workspace's own resources are read. A workspace used to carry a trust flag that decided
 * this, on the reasoning that a workspace is often a repository somebody else wrote and its
 * `AGENTS.md` is prompt injection; what that flag actually did was make the *only* folder the
 * agent is supposed to work in the one folder it could not take instructions from, while leaving
 * its tools free to read the whole machine. Reach is the sandbox's business, and this is not it.
 */
export async function loadCatalog(roots: LayerRoots, files: Files): Promise<Catalog> {
	const defaults: LayerTrace[] = [];
	const discovered: AgentDefinition[] = [];

	for (const [layer, folders] of [
		["global", roots.global],
		["workspace", roots.workspace],
	] as const) {
		for (const root of folders) {
			const config = await loadConfig(files, join(root, "config.json"), layer);
			if (config !== null) {
				defaults.push({ layer, path: config.path, contributes: config.contributions });
			}
			discovered.push(...(await loadAgentDir(files, join(root, "agents"), layer)));
		}
	}

	// Later folders shadow earlier ones: the workspace beats the install, and the native folder
	// beats the ecosystem one beside it.
	const byName = new Map<string, AgentDefinition>();
	for (const agent of discovered) byName.set(agent.name, agent);

	// The agent a conversation runs when nothing named one, as a definition rather than a
	// special case: it can be listed, chosen, and pinned by name like any other, and an
	// install that wants its own general writes `general.md` and shadows this.
	if (!byName.has(GENERAL_AGENT)) {
		byName.set(GENERAL_AGENT, {
			name: GENERAL_AGENT,
			description: "General assistant",
			source: "",
			layer: "built-in",
			contributions: {},
		});
	}

	return { defaults, agents: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}

/**
 * Folds the layers in order. Instructions concatenate, last model and thinking
 * win, skills union, tool denials union, and an allow list replaces.
 */
export function resolveAgent(catalog: Catalog, name: string | undefined): ResolvedAgent {
	const definition =
		name === undefined ? undefined : catalog.agents.find((agent) => agent.name === name);
	const layers: LayerTrace[] = [...catalog.defaults];
	// A built-in has no file, so there is no layer to trace it to.
	if (definition !== undefined && definition.source !== "") {
		layers.push({
			layer: "agent",
			path: definition.source,
			contributes: definition.contributions,
		});
	}

	let model: string | undefined;
	let thinking: string | undefined;
	let skills: string[] | undefined;
	let allowTools: string[] | undefined;
	const denyTools = new Set<string>();
	const instructions: string[] = [];
	let delegation: Partial<Delegation> | undefined;
	const guards: Guard[] = [];

	for (const { contributes } of layers) {
		if (contributes.model !== undefined) model = contributes.model;
		if (contributes.thinking !== undefined) thinking = contributes.thinking;
		if (contributes.instructions !== undefined && contributes.instructions.length > 0) {
			instructions.push(contributes.instructions);
		}
		if (contributes.skills !== undefined)
			skills = [...new Set([...(skills ?? []), ...contributes.skills])];
		if (contributes.allowTools !== undefined) allowTools = contributes.allowTools;
		if (contributes.denyTools !== undefined)
			for (const tool of contributes.denyTools) denyTools.add(tool);
		if (contributes.delegation !== undefined)
			delegation = { ...delegation, ...contributes.delegation };
		if (contributes.guards !== undefined) guards.push(...contributes.guards);
	}

	// A deny always wins over an allow, so a workspace cannot be over-permissioned
	// by an agent file that lists the same tool twice.
	const effectiveAllow = allowTools?.filter((tool) => !denyTools.has(tool));

	return {
		name: definition?.name ?? "general",
		description: definition?.description ?? "General assistant",
		source: definition?.source ?? "",
		delegation: { ...DEFAULT_DELEGATION, ...delegation },
		guards,
		...(model === undefined ? {} : { model }),
		...(thinking === undefined ? {} : { thinking }),
		instructions: instructions.join("\n\n"),
		skills: skills ?? null,
		...(effectiveAllow === undefined ? {} : { allowTools: effectiveAllow }),
		denyTools: [...denyTools],
		layers,
	};
}
