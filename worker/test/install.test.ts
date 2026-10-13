/**
 * The install id: what a sign-in that identifies the app to its provider gets, and what has to
 * be the same value the next time. OpenAI's ChatGPT login sends it as the agent host id and
 * refuses to start without one, so "stable across runs" is the whole contract.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { installId, installIdPath } from "../src/install.ts";
import { cleanupScratch, tempDir } from "./scratch.ts";

afterAll(cleanupScratch);

describe("the install id", () => {
	test("is created on the first sign-in and the same from then on", async () => {
		const home = await tempDir("acornfall-install-");
		const first = await installId(home);
		expect(first).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
		expect(await installId(home)).toBe(first);
	});

	test("lives in the install's home, so the next run finds it", async () => {
		const home = await tempDir("acornfall-install-");
		const id = await installId(home);
		expect((await readFile(installIdPath(home), "utf8")).trim()).toBe(id);
	});

	test("an empty file is a new id, not an empty one", async () => {
		const home = await tempDir("acornfall-install-");
		await Bun.write(installIdPath(home), "\n");
		const id = await installId(home);
		expect(id).not.toBe("");
		expect((await readFile(installIdPath(home), "utf8")).trim()).toBe(id);
	});

	test("two installs get different ids", async () => {
		const [one, two] = await Promise.all([
			installId(await tempDir("acornfall-install-")),
			installId(await tempDir("acornfall-install-")),
		]);
		expect(one).not.toBe(two);
	});
});
