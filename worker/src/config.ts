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
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export type LayerName = "global" | "workspace" | "agent";

export interface Contributions {
	model?: string;
	thinking?: string;
	instructions?: string;
	skills?: string[];
	allowTools?: string[];
	denyTools?: string[];
}

export interface AgentDefinition {
	name: string;
	description: string;
	/** File the definition came from; a workspace file shadows a global one. */
	source: string;
	layer: "global" | "workspace";
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
]);

function parseList(raw: string): string[] {
	return raw
		.replace(/^\[|\]$/g, "")
		.split(",")
		.map((item) => item.trim().replace(/^["']|["']$/g, ""))
		.filter((item) => item.length > 0);
}

/** Parses frontmatter into contributions. Unknown keys are reported by the caller. */
function parseFrontmatter(source: string): { values: Record<string, string>; body: string; unknown: string[] } {
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
async function loadConfig(path: string, label: LayerName): Promise<{ contributions: Contributions; path: string } | null> {
	let text: string;
	try {
		text = await readFile(path, "utf8");
	} catch {
		return null;
	}
	let parsed: Record<string, unknown>;
	try {
		parsed = JSON.parse(text) as Record<string, unknown>;
	} catch (error) {
		throw new Error(`${label} config at ${path} is not valid JSON: ${(error as Error).message}`);
	}
	const source = (parsed.defaults ?? parsed) as Record<string, unknown>;
	const contributions: Contributions = {};
	if (typeof source.model === "string") contributions.model = source.model;
	if (typeof source.thinking === "string") contributions.thinking = source.thinking;
	if (typeof source.instructions === "string") contributions.instructions = source.instructions;
	if (Array.isArray(source.skills)) contributions.skills = source.skills.map(String);
	if (Array.isArray(source.allowTools)) contributions.allowTools = source.allowTools.map(String);
	if (Array.isArray(source.denyTools)) contributions.denyTools = source.denyTools.map(String);
	return { contributions, path };
}

async function loadAgentDir(directory: string, layer: "global" | "workspace"): Promise<AgentDefinition[]> {
	const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
	const agents: AgentDefinition[] = [];
	for (const entry of entries) {
		if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
		const path = join(directory, entry.name);
		const source = await readFile(path, "utf8").catch(() => null);
		if (source === null) continue;
		const { values, body, unknown } = parseFrontmatter(source);
		const name = values.name ?? entry.name.replace(/\.md$/, "");
		const contributions: Contributions = {};
		if (values.model !== undefined) contributions.model = values.model;
		if (values.thinking !== undefined) contributions.thinking = values.thinking;
		const instructions = [values.instructions, body].filter((text) => text !== undefined && text.length > 0);
		if (instructions.length > 0) contributions.instructions = instructions.join("\n\n");
		if (values.skills !== undefined) contributions.skills = parseList(values.skills);
		if (values["allow-tools"] !== undefined) contributions.allowTools = parseList(values["allow-tools"]);
		if (values["deny-tools"] !== undefined) contributions.denyTools = parseList(values["deny-tools"]);
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

export async function loadCatalog(dataDir: string, workspace: string): Promise<Catalog> {
	const global = await loadConfig(join(dataDir, "config.json"), "global");
	const workspaceConfig = await loadConfig(join(workspace, ".acornfall", "config.json"), "workspace");
	const defaults: LayerTrace[] = [];
	if (global !== null) defaults.push({ layer: "global", path: global.path, contributes: global.contributions });
	if (workspaceConfig !== null) {
		defaults.push({ layer: "workspace", path: workspaceConfig.path, contributes: workspaceConfig.contributions });
	}

	// The workspace shadows a global definition of the same name.
	const byName = new Map<string, AgentDefinition>();
	for (const agent of await loadAgentDir(join(dataDir, "agents"), "global")) byName.set(agent.name, agent);
	for (const agent of await loadAgentDir(join(workspace, ".acornfall", "agents"), "workspace")) {
		byName.set(agent.name, agent);
	}
	return { defaults, agents: [...byName.values()].sort((a, b) => a.name.localeCompare(b.name)) };
}

/**
 * Folds the layers in order. Instructions concatenate, last model and thinking
 * win, skills union, tool denials union, and an allow list replaces.
 */
export function resolveAgent(catalog: Catalog, name: string | undefined): ResolvedAgent {
	const definition = name === undefined ? undefined : catalog.agents.find((agent) => agent.name === name);
	const layers: LayerTrace[] = [...catalog.defaults];
	if (definition !== undefined) {
		layers.push({ layer: "agent", path: definition.source, contributes: definition.contributions });
	}

	let model: string | undefined;
	let thinking: string | undefined;
	let skills: string[] | undefined;
	let allowTools: string[] | undefined;
	const denyTools = new Set<string>();
	const instructions: string[] = [];

	for (const { layer, contributes } of layers) {
		if (contributes.model !== undefined) model = contributes.model;
		if (contributes.thinking !== undefined) thinking = contributes.thinking;
		if (contributes.instructions !== undefined && contributes.instructions.length > 0) {
			instructions.push(contributes.instructions);
		}
		if (contributes.skills !== undefined) skills = [...new Set([...(skills ?? []), ...contributes.skills])];
		if (contributes.allowTools !== undefined) allowTools = contributes.allowTools;
		if (contributes.denyTools !== undefined) for (const tool of contributes.denyTools) denyTools.add(tool);
	}

	// A deny always wins over an allow, so a workspace cannot be over-permissioned
	// by an agent file that lists the same tool twice.
	const effectiveAllow = allowTools?.filter((tool) => !denyTools.has(tool));

	return {
		name: definition?.name ?? "default",
		description: definition?.description ?? "Default assistant",
		source: definition?.source ?? "",
		...(model === undefined ? {} : { model }),
		...(thinking === undefined ? {} : { thinking }),
		instructions: instructions.join("\n\n"),
		skills: skills ?? null,
		...(effectiveAllow === undefined ? {} : { allowTools: effectiveAllow }),
		denyTools: [...denyTools],
		layers,
	};
}
