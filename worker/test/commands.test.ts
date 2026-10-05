/**
 * Slash commands: discovery from two layers, and expansion, which is what the transcript has
 * to record — the text the model saw, not the shorthand the user typed.
 */
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expandCommand, loadCommands, parseCommandInvocation } from "../src/commands.ts";

async function write(path: string, content: string): Promise<void> {
	await mkdir(join(path, "..").replace(/\/[^/]+$/, ""), { recursive: true });
	await writeFile(path, content);
}

describe("invocation", () => {
	test("reads a name and its arguments", () => {
		expect(parseCommandInvocation("/summarize the notes")).toEqual({ name: "summarize", args: "the notes" });
		expect(parseCommandInvocation("/status")).toEqual({ name: "status", args: "" });
		expect(parseCommandInvocation("  /deploy  now  ")).toEqual({ name: "deploy", args: "now" });
	});

	test("leaves anything that is not a command alone", () => {
		expect(parseCommandInvocation("what is /summarize")).toBeUndefined();
		expect(parseCommandInvocation("/ with a space")).toBeUndefined();
		expect(parseCommandInvocation("/UPPER")).toBeUndefined();
		expect(parseCommandInvocation("/-leading-dash")).toBeUndefined();
		expect(parseCommandInvocation("")).toBeUndefined();
	});
});

describe("expansion", () => {
	const command = { name: "x", description: "", source: "", body: "Summarize $ARGUMENTS in one line." };

	test("puts the arguments where the template says", () => {
		expect(expandCommand(command, "the notes")).toBe("Summarize the notes in one line.");
		expect(expandCommand(command, "  the notes  ")).toBe("Summarize the notes in one line.");
	});

	test("replaces every placeholder", () => {
		const twice = { ...command, body: "$ARGUMENTS and again $ARGUMENTS" };
		expect(expandCommand(twice, "x")).toBe("x and again x");
	});

	test("appends the arguments when there is no placeholder, rather than losing them", () => {
		const plain = { ...command, body: "Do the thing." };
		expect(expandCommand(plain, "extra words")).toBe("Do the thing.\n\nextra words");
		expect(expandCommand(plain, "")).toBe("Do the thing.");
	});

	test("with a placeholder and no arguments, the hole is empty rather than literal", () => {
		expect(expandCommand(command, "")).toBe("Summarize  in one line.");
	});
});

describe("loading", () => {
	test("reads frontmatter, keeps the body, and sorts by name", async () => {
		const root = await mkdtemp(join(tmpdir(), "acornfall-commands-"));
		await write(join(root, "b.md"), "---\nname: bravo\ndescription: second\nargument-hint: a thing\n---\nBody B");
		await write(join(root, "a.md"), "---\nname: alpha\ndescription: first\n---\nBody A");

		const commands = await loadCommands([root]);
		expect(commands.map((command) => command.name)).toEqual(["alpha", "bravo"]);
		expect(commands[1]?.description).toBe("second");
		expect(commands[1]?.argumentHint).toBe("a thing");
		expect(commands[0]?.body).toBe("Body A");
	});

	test("the file name is the name when frontmatter does not give one", async () => {
		const root = await mkdtemp(join(tmpdir(), "acornfall-commands-"));
		await write(join(root, "from-file-name.md"), "Just the body.");
		const commands = await loadCommands([root]);
		expect(commands[0]?.name).toBe("from-file-name");
	});

	test("a command with no body is not a command", async () => {
		const root = await mkdtemp(join(tmpdir(), "acornfall-commands-"));
		await write(join(root, "empty.md"), "---\nname: empty\n---\n");
		expect(await loadCommands([root])).toEqual([]);
	});

	test("a later root shadows an earlier one, which is how a workspace overrides the install", async () => {
		const first = await mkdtemp(join(tmpdir(), "acornfall-commands-"));
		const second = await mkdtemp(join(tmpdir(), "acornfall-commands-"));
		await write(join(first, "deploy.md"), "---\nname: deploy\ndescription: install\n---\nInstall deploy");
		await write(join(second, "deploy.md"), "---\nname: deploy\ndescription: workspace\n---\nWorkspace deploy");

		const commands = await loadCommands([first, second]);
		expect(commands).toHaveLength(1);
		expect(commands[0]?.description).toBe("workspace");
	});

	test("a directory that does not exist is not an error", async () => {
		expect(await loadCommands(["/nope/not/here"])).toEqual([]);
	});
});
