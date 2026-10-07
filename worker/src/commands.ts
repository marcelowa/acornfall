/**
 * Slash commands: named prompt templates, discovered from the same two layers as
 * everything else.
 *
 * A command is a message the user would otherwise retype. Expansion happens here rather
 * than in the interface, so there is one implementation and the transcript records the
 * text the model actually saw.
 */
import type { Files } from "./files.ts";
import { isAbsolute, join, resolve } from "node:path";

export interface Command {
	name: string;
	description: string;
	argumentHint?: string;
	/** Where it came from, for the explain view. */
	source: string;
	/** The template, with its frontmatter removed. */
	body: string;
}

const KNOWN_KEYS = new Set(["name", "description", "argument-hint"]);

function parseFrontmatter(source: string): { values: Record<string, string>; body: string } {
	const values: Record<string, string> = {};
	if (!source.startsWith("---")) return { values, body: source.trim() };
	const end = source.indexOf("\n---", 3);
	if (end === -1) return { values, body: source.trim() };
	for (const rawLine of source.slice(3, end).split("\n")) {
		const line = rawLine.trim();
		const colon = line.indexOf(":");
		if (colon === -1) continue;
		const key = line.slice(0, colon).trim();
		if (!KNOWN_KEYS.has(key)) continue;
		values[key] = line
			.slice(colon + 1)
			.trim()
			.replace(/^["']|["']$/g, "");
	}
	return { values, body: source.slice(end + 4).trim() };
}

async function isDirectory(files: Files, path: string): Promise<boolean> {
	return (await files.stat(path))?.directory === true;
}

/** Later roots shadow earlier ones, so a workspace command replaces a global one. */
export async function loadCommands(roots: readonly string[], files: Files): Promise<Command[]> {
	const byName = new Map<string, Command>();
	for (const root of roots) {
		const base = isAbsolute(root) ? root : resolve(process.cwd(), root);
		if (!(await isDirectory(files, base))) continue;
		for (const entry of await files.list(base)) {
			if (entry.directory || !entry.name.endsWith(".md")) continue;
			const path = join(base, entry.name);
			const source = await files.read(path);
			if (source === null) continue;
			const { values, body } = parseFrontmatter(source);
			const name = values.name ?? entry.name.replace(/\.md$/, "");
			if (body === "") continue;
			byName.set(name, {
				name,
				description: values.description ?? "",
				...(values["argument-hint"] === undefined
					? {}
					: { argumentHint: values["argument-hint"] }),
				source: path,
				body,
			});
		}
	}
	return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * The template with its arguments in place. A template without `$ARGUMENTS` gets them
 * appended, because losing what the user typed is worse than an extra line.
 */
export function expandCommand(command: Command, args: string): string {
	const trimmed = args.trim();
	if (command.body.includes("$ARGUMENTS")) {
		return command.body.split("$ARGUMENTS").join(trimmed);
	}
	return trimmed === "" ? command.body : `${command.body}\n\n${trimmed}`;
}

/** Matches `/name rest` at the start of a message. */
export function parseCommandInvocation(text: string): { name: string; args: string } | undefined {
	const match = /^\/([a-z0-9][a-z0-9-]{0,63})(?:\s+([\s\S]*))?$/.exec(text.trim());
	if (match === null) return undefined;
	return { name: match[1]!, args: (match[2] ?? "").trim() };
}
