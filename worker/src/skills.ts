/**
 * Skills: progressively disclosed instructions, following the Agent Skills
 * layout (`<dir>/<name>/SKILL.md`).
 *
 * Only name and description reach the prompt. The body loads when the model
 * calls `skill`, which keeps detailed guidance out of context until it is used.
 */
import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { Type } from "@earendil-works/pi-ai";
import { defineExtension, defineTool, section } from "@earendil-works/pi-durable";

export interface Skill {
	name: string;
	description: string;
	disableModelInvocation: boolean;
	dir: string;
	path: string;
}

interface Frontmatter {
	name?: string;
	description?: string;
	disableModelInvocation: boolean;
}

function parseFrontmatter(source: string): Frontmatter {
	const result: Frontmatter = { disableModelInvocation: false };
	if (!source.startsWith("---")) return result;
	const end = source.indexOf("\n---", 3);
	if (end === -1) return result;
	for (const rawLine of source.slice(3, end).split("\n")) {
		const line = rawLine.trim();
		const colon = line.indexOf(":");
		if (colon === -1) continue;
		const key = line.slice(0, colon).trim();
		const value = line.slice(colon + 1).trim().replace(/^["']|["']$/g, "");
		if (key === "name") result.name = value;
		else if (key === "description") result.description = value;
		else if (key === "disable-model-invocation") result.disableModelInvocation = value === "true";
	}
	return result;
}

/** Strip frontmatter and return the instruction body. */
export function skillBody(source: string): string {
	if (!source.startsWith("---")) return source.trim();
	const end = source.indexOf("\n---", 3);
	if (end === -1) return source.trim();
	return source.slice(end + 4).trim();
}

async function isDirectory(path: string): Promise<boolean> {
	try {
		return (await stat(path)).isDirectory();
	} catch {
		return false;
	}
}

/** Discovery is shallow on purpose: one level of grouping, then skill directories. */
export async function loadSkills(roots: readonly string[]): Promise<Skill[]> {
	// Later roots shadow earlier ones, the same way agents and commands do: a workspace skill
	// with a global skill's name replaces it, and `.acornfall` replaces `.agents`.
	const byName = new Map<string, Skill>();
	for (const root of roots) {
		const base = isAbsolute(root) ? root : resolve(process.cwd(), root);
		if (!(await isDirectory(base))) continue;
		const entries = await readdir(base, { withFileTypes: true }).catch(() => []);
		for (const entry of entries) {
			if (!entry.isDirectory()) continue;
			const dir = join(base, entry.name);
			const path = join(dir, "SKILL.md");
			let source: string;
			try {
				source = await readFile(path, "utf8");
			} catch {
				continue;
			}
			const front = parseFrontmatter(source);
			const name = front.name ?? entry.name;
			if (front.description === undefined || front.description.length === 0) continue;
			byName.set(name, {
				name,
				description: front.description,
				disableModelInvocation: front.disableModelInvocation,
				dir,
				path,
			});
		}
	}
	// Sorted so the prompt's skill section does not depend on the order a filesystem listed.
	return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

export function renderSkills(skills: readonly Skill[], allowed: readonly string[] | null): string | undefined {
	const usable = skills.filter(
		(skill) => !skill.disableModelInvocation && (allowed === null || allowed.includes(skill.name)),
	);
	if (usable.length === 0) return undefined;
	const lines = usable.map((skill) => `- ${skill.name}: ${skill.description}\n  dir: ${skill.dir}`);
	return `Skills provide specialized instructions. Read one with the skill tool before starting work it covers.\n\n${lines.join("\n")}`;
}

/**
 * The skill set is resolved per request from the conversation's agent, not
 * captured at install time: two conversations can run different agents with
 * different skills at the same time.
 */
export function skillsExtension(
	skills: readonly Skill[],
	allowedFor: (conversationId: string) => readonly string[] | null,
) {
	const permitted = (conversationId: string): readonly Skill[] => {
		const names = allowedFor(conversationId);
		return names === null ? skills : skills.filter((skill) => names.includes(skill.name));
	};
	return defineExtension({
		name: "acornfall-skills",
		sections: [
			section("skills", (input) => renderSkills(skills, allowedFor(String(input.conversationId)))),
		],
		tools: [
			defineTool({
				name: "skill",
				description:
					"Load the full instructions for a skill by name. Use it before work the skill describes.",
				parameters: Type.Object({
					name: Type.String({ description: "Skill name, as listed in the skills section" }),
					args: Type.Optional(Type.String({ description: "Optional request or arguments for the skill" })),
				}),
				execute: async (args, api) => {
					const available = permitted(String(api.conversationId));
					const skill = available.find((candidate) => candidate.name === args.name);
					if (skill === undefined) {
						const names = available.map((candidate) => candidate.name).join(", ");
						return {
							content: [
								{
									type: "text" as const,
									text: `Skill "${args.name}" is not available here. Available: ${names || "none"}.`,
								},
							],
						};
					}
					const source = await readFile(skill.path, "utf8");
					const body = skillBody(source);
					const request = args.args === undefined ? "" : `\n\nUser request: ${args.args}`;
					return {
						content: [
							{
								type: "text" as const,
								text: `# Skill: ${skill.name}\nDirectory: ${skill.dir}\n\n${body}${request}`,
							},
						],
					};
				},
			}),
		],
	});
}
