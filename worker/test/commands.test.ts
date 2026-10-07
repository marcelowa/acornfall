/**
 * Slash commands: discovery from two layers, and expansion, which is what the transcript has
 * to record — the text the model saw, not the shorthand the user typed.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { expandCommand, loadCommands, parseCommandInvocation } from "../src/commands.ts";
import { COMMAND_DIRS, layerRoots, resourceFolders } from "../src/config.ts";
import { cleanupScratch, tempDir, write } from "./scratch.ts";
import { hostFiles } from "../src/files.ts";

afterAll(cleanupScratch);

describe("invocation", () => {
	test("reads a name and its arguments", () => {
		expect(parseCommandInvocation("/summarize the notes")).toEqual({
			name: "summarize",
			args: "the notes",
		});
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
	const command = {
		name: "x",
		description: "",
		source: "",
		body: "Summarize $ARGUMENTS in one line.",
	};

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
		const root = await tempDir("acornfall-commands-");
		await write(
			join(root, "b.md"),
			"---\nname: bravo\ndescription: second\nargument-hint: a thing\n---\nBody B",
		);
		await write(join(root, "a.md"), "---\nname: alpha\ndescription: first\n---\nBody A");

		const commands = await loadCommands([root], hostFiles);
		expect(commands.map((command) => command.name)).toEqual(["alpha", "bravo"]);
		expect(commands[1]?.description).toBe("second");
		expect(commands[1]?.argumentHint).toBe("a thing");
		expect(commands[0]?.body).toBe("Body A");
	});

	test("the file name is the name when frontmatter does not give one", async () => {
		const root = await tempDir("acornfall-commands-");
		await write(join(root, "from-file-name.md"), "Just the body.");
		const commands = await loadCommands([root], hostFiles);
		expect(commands[0]?.name).toBe("from-file-name");
	});

	test("a command with no body is not a command", async () => {
		const root = await tempDir("acornfall-commands-");
		await write(join(root, "empty.md"), "---\nname: empty\n---\n");
		expect(await loadCommands([root], hostFiles)).toEqual([]);
	});

	test("a later root shadows an earlier one, which is how a workspace overrides the install", async () => {
		const first = await tempDir("acornfall-commands-");
		const second = await tempDir("acornfall-commands-");
		await write(
			join(first, "deploy.md"),
			"---\nname: deploy\ndescription: install\n---\nInstall deploy",
		);
		await write(
			join(second, "deploy.md"),
			"---\nname: deploy\ndescription: workspace\n---\nWorkspace deploy",
		);

		const commands = await loadCommands([first, second], hostFiles);
		expect(commands).toHaveLength(1);
		expect(commands[0]?.description).toBe("workspace");
	});

	test("the ecosystem's prompts folder is read too, and our commands folder wins", async () => {
		const root = await tempDir("acornfall-commands-");
		const workspace = join(root, "workspace");
		// The same name in both folder names: ours is read second and wins.
		await write(
			join(workspace, ".agents", "prompts", "audit.md"),
			"---\nname: audit\ndescription: from prompts\n---\nPrompts body",
		);
		await write(
			join(workspace, ".agents", "commands", "audit.md"),
			"---\nname: audit\ndescription: from commands\n---\nCommands body",
		);
		// And one that only exists as a prompt, which is the case a shared bundle has.
		await write(
			join(workspace, ".agents", "prompts", "only-here.md"),
			"---\nname: only-here\ndescription: prompts only\n---\nBody",
		);

		const roots = layerRoots({
			home: join(root, "home"),
			workspace,
			userHome: join(root, "user"),
		});
		const commands = await loadCommands(resourceFolders(roots, COMMAND_DIRS), hostFiles);
		expect(commands.map((command) => [command.name, command.description])).toEqual([
			["audit", "from commands"],
			["only-here", "prompts only"],
		]);
		expect(commands[1]?.source).toContain("/prompts/");
	});

	test("the .agents folder is read, and ours shadows it", async () => {
		const root = await tempDir("acornfall-commands-");
		const home = join(root, "home");
		const workspace = join(root, "workspace");
		const user = join(root, "user");
		// The same command in all three places it can live: the user's ecosystem folder, the
		// workspace's, and ours beside it. Ours is read last and wins.
		await write(
			join(user, ".agents", "commands", "deploy.md"),
			"---\nname: deploy\ndescription: user\n---\nUser",
		);
		await write(
			join(workspace, ".agents", "commands", "deploy.md"),
			"---\nname: deploy\ndescription: ecosystem\n---\nEco",
		);
		await write(
			join(workspace, ".acornfall", "commands", "deploy.md"),
			"---\nname: deploy\ndescription: native\n---\nNative",
		);
		await write(
			join(workspace, ".agents", "commands", "shared.md"),
			"---\nname: shared\ndescription: only in .agents\n---\nShared",
		);

		const roots = layerRoots({ home, workspace, userHome: user });
		const commands = await loadCommands(resourceFolders(roots, ["commands"]), hostFiles);
		expect(commands.map((command) => [command.name, command.description])).toEqual([
			["deploy", "native"],
			["shared", "only in .agents"],
		]);
	});

	test("a directory that does not exist is not an error", async () => {
		expect(await loadCommands(["/nope/not/here"], hostFiles)).toEqual([]);
	});
});
