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
	const skills: Skill[] = [];
	const seen = new Set<string>();
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
			if (seen.has(name)) continue;
			seen.add(name);
			skills.push({
				name,
				description: front.description,
				disableModelInvocation: front.disableModelInvocation,
				dir,
				path,
			});
		}
	}
	return skills;
}

export function renderSkills(skills: readonly Skill[]): string | undefined {
	const usable = skills.filter((skill) => !skill.disableModelInvocation);
	if (usable.length === 0) return undefined;
	const lines = usable.map((skill) => `- ${skill.name}: ${skill.description}\n  dir: ${skill.dir}`);
	return `Skills provide specialized instructions. Read one with the skill tool before starting work it covers.\n\n${lines.join("\n")}`;
}

export function skillsExtension(skills: readonly Skill[]) {
	const byName = new Map(skills.map((skill) => [skill.name, skill]));
	return defineExtension({
		name: "acornfall-skills",
		sections: [section("skills", () => renderSkills(skills))],
		tools: [
			defineTool({
				name: "skill",
				description:
					"Load the full instructions for a skill by name. Use it before work the skill describes.",
				parameters: Type.Object({
					name: Type.String({ description: "Skill name, as listed in the skills section" }),
					args: Type.Optional(Type.String({ description: "Optional request or arguments for the skill" })),
				}),
				execute: async (args) => {
					const skill = byName.get(args.name);
					if (skill === undefined) {
						const available = [...byName.keys()].join(", ");
						return {
							content: [
								{
									type: "text" as const,
									text: `Unknown skill "${args.name}". Available: ${available || "none"}.`,
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
