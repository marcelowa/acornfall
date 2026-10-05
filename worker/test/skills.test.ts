/**
 * Skills, credentials, and conversation ids: the small rules the rest of the system relies on.
 */
import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { loadSkills, renderSkills, skillBody } from "../src/skills.ts";
import { FileCredentialStore } from "../src/credentials.ts";
import { conversationIdOf } from "../src/meta.ts";

async function write(path: string, content: string, mode?: number): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, content, mode === undefined ? {} : { mode });
}

describe("skills", () => {
	test("a skill is a directory holding SKILL.md, and needs a description", async () => {
		const root = await mkdtemp(join(tmpdir(), "acornfall-skills-"));
		await write(join(root, "documented", "SKILL.md"), "---\nname: documented\ndescription: does a thing\n---\nBody");
		await write(join(root, "silent", "SKILL.md"), "---\nname: silent\n---\nBody");
		await write(join(root, "loose.md"), "not in a directory");

		const skills = await loadSkills([root]);
		expect(skills.map((skill) => skill.name)).toEqual(["documented"]);
		expect(skills[0]?.description).toBe("does a thing");
	});

	test("the directory name is the fallback when frontmatter has none", async () => {
		const root = await mkdtemp(join(tmpdir(), "acornfall-skills-"));
		await write(join(root, "acorn-notes", "SKILL.md"), "---\ndescription: from the folder\n---\nBody");
		const skills = await loadSkills([root]);
		expect(skills[0]?.name).toBe("acorn-notes");
	});

	test("the body is available but not what the prompt carries", () => {
		expect(skillBody("---\nname: x\n---\nThe body.")).toBe("The body.");
		expect(skillBody("No frontmatter at all.")).toBe("No frontmatter at all.");
	});

	test("only names and descriptions are offered, and only the allowed ones", () => {
		const skills = [
			{ name: "a", description: "first", disableModelInvocation: false, dir: "/d", path: "/d/SKILL.md" },
			{ name: "b", description: "second", disableModelInvocation: false, dir: "/d", path: "/d/SKILL.md" },
			{ name: "hidden", description: "manual only", disableModelInvocation: true, dir: "/d", path: "/d/SKILL.md" },
		];
		const offered = renderSkills(skills, null);
		expect(offered).toContain("a");
		expect(offered).toContain("first");
		expect(offered).not.toContain("manual only");

		const restricted = renderSkills(skills, ["b"]);
		expect(restricted).toContain("second");
		expect(restricted).not.toContain("first");

		expect(renderSkills(skills, [])).toBeUndefined();
		expect(renderSkills([], null)).toBeUndefined();
	});
});

describe("credentials", () => {
	test("round-trips a credential and keeps the file private", async () => {
		const dir = await mkdtemp(join(tmpdir(), "acornfall-credentials-"));
		const path = join(dir, "credentials.json");
		const store = new FileCredentialStore(path);

		expect(await store.read("opencode-go")).toBeUndefined();
		await store.modify("opencode-go", async () => ({ type: "api_key", key: "secret-value" }));

		const credential = await store.read("opencode-go");
		expect(credential).toEqual({ type: "api_key", key: "secret-value" });

		const mode = (await stat(path)).mode & 0o777;
		expect(mode).toBe(0o600);

		const listed = await store.list();
		expect(listed).toEqual([{ providerId: "opencode-go", type: "api_key" }]);
	});

	test("reading hands back a copy, so a caller cannot mutate the store by accident", async () => {
		const dir = await mkdtemp(join(tmpdir(), "acornfall-credentials-"));
		const store = new FileCredentialStore(join(dir, "credentials.json"));
		await store.modify("p", async () => ({ type: "api_key", key: "k" }));

		const first = await store.read("p");
		if (first !== undefined && first.type === "api_key") first.key = "mutated";
		expect(await store.read("p")).toEqual({ type: "api_key", key: "k" });
	});

	test("modify returning nothing leaves the credential alone; delete is what removes it", async () => {
		const dir = await mkdtemp(join(tmpdir(), "acornfall-credentials-"));
		const store = new FileCredentialStore(join(dir, "credentials.json"));
		await store.modify("p", async () => ({ type: "api_key", key: "k" }));

		// "I have nothing to change" and "remove this" are different answers.
		await store.modify("p", async () => undefined);
		expect(await store.read("p")).toEqual({ type: "api_key", key: "k" });

		await store.delete("p");
		expect(await store.read("p")).toBeUndefined();
	});

	test("a corrupt file is an error, not an empty credential store", async () => {
		const dir = await mkdtemp(join(tmpdir(), "acornfall-credentials-"));
		const path = join(dir, "credentials.json");
		await write(path, "{ this is not json");
		const store = new FileCredentialStore(path);
		await expect(store.read("p")).rejects.toThrow();
	});
});

describe("conversation ids", () => {
	test("are the harness's own positive integers", () => {
		expect(conversationIdOf("1") as number).toBe(1);
		expect(conversationIdOf("1276") as number).toBe(1276);
	});

	test("anything else is refused rather than coerced", () => {
		expect(() => conversationIdOf("0")).toThrow();
		expect(() => conversationIdOf("-3")).toThrow();
		expect(() => conversationIdOf("1.5")).toThrow();
		expect(() => conversationIdOf("abc")).toThrow();
		expect(() => conversationIdOf("")).toThrow();
	});
});
