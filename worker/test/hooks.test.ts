/**
 * Guards are a security-shaped rule, so their edge cases are the point: a path that climbs
 * out, a tool that matches everything, an argument that is not a string at all.
 */
import { describe, expect, test } from "bun:test";
import { matches, resolvePath } from "../src/hooks.ts";
import type { Guard } from "../src/config.ts";

const cwd = "/work/project";
const bash = (command: string) => ({ name: "bash", arguments: { command } });
const write = (path: string) => ({ name: "write", arguments: { path } });

describe("a pattern guard", () => {
	const guard: Guard = { tool: "bash", arg: "command", pattern: "rm\\s+-rf", reason: "no" };

	test("blocks the arguments it matches", () => {
		expect(matches(guard, bash("rm -rf /"), cwd)).toBe(true);
		expect(matches(guard, bash("cd x && rm   -rf y"), cwd)).toBe(true);
	});

	test("ignores a call that merely contains the words", () => {
		expect(matches(guard, bash("echo 'do not rm -rf anything'"), cwd)).toBe(true); // a pattern is not a parser
		expect(matches(guard, bash("rm -f x"), cwd)).toBe(false);
		expect(matches(guard, bash("ls -la"), cwd)).toBe(false);
	});

	test("only applies to its tool", () => {
		expect(matches(guard, { name: "write", arguments: { command: "rm -rf /" } }, cwd)).toBe(false);
	});

	test("a wildcard tool applies to every tool", () => {
		const anyTool: Guard = { tool: "*", arg: "command", pattern: "sudo", reason: "no" };
		expect(matches(anyTool, bash("sudo reboot"), cwd)).toBe(true);
		expect(matches(anyTool, { name: "other", arguments: { command: "sudo now" } }, cwd)).toBe(true);
	});

	test("an argument that is missing, empty, or not a string cannot match", () => {
		expect(matches(guard, { name: "bash", arguments: {} }, cwd)).toBe(false);
		expect(matches(guard, bash(""), cwd)).toBe(false);
		expect(matches(guard, { name: "bash", arguments: { command: 42 } }, cwd)).toBe(false);
	});
});

describe("an outside guard", () => {
	const guard: Guard = { tool: "write", arg: "path", outside: true, reason: "stay here" };

	test("allows paths inside the workspace", () => {
		expect(matches(guard, write("notes.md"), cwd)).toBe(false);
		expect(matches(guard, write("deep/nested/file.txt"), cwd)).toBe(false);
		expect(matches(guard, write("/work/project/notes.md"), cwd)).toBe(false);
		expect(matches(guard, write("./notes.md"), cwd)).toBe(false);
	});

	test("blocks absolute paths elsewhere", () => {
		expect(matches(guard, write("/etc/passwd"), cwd)).toBe(true);
		expect(matches(guard, write("/work/other/file"), cwd)).toBe(true);
		// A prefix is not a parent: a sibling whose name starts the same is still outside.
		expect(matches(guard, write("/work/project-other/file"), cwd)).toBe(true);
	});

	test("blocks a path that climbs out, however it is written", () => {
		expect(matches(guard, write("../outside.txt"), cwd)).toBe(true);
		expect(matches(guard, write("deep/../../outside.txt"), cwd)).toBe(true);
		expect(matches(guard, write("/work/project/../outside.txt"), cwd)).toBe(true);
		// And a detour that lands back inside is inside.
		expect(matches(guard, write("deep/../notes.md"), cwd)).toBe(false);
	});

	test("blocks the workspace directory itself, which would replace the folder", () => {
		expect(matches(guard, write("."), cwd)).toBe(true);
		expect(matches(guard, write("/work/project"), cwd)).toBe(true);
	});
});

describe("resolvePath", () => {
	test("resolves the way a shell would, without touching the filesystem", () => {
		expect(resolvePath("/work/project", "a/b")).toBe("/work/project/a/b");
		expect(resolvePath("/work/project", "/a/b")).toBe("/a/b");
		expect(resolvePath("/work/project", "../x")).toBe("/work/x");
		expect(resolvePath("/work/project", "./a/./b/")).toBe("/work/project/a/b");
		expect(resolvePath("/work/project", "/..")).toBe("/");
		expect(resolvePath("/work/project", "a//b")).toBe("/work/project/a/b");
	});
});
