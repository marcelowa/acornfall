/**
 * The resource overlay: three layers folding into one resolved agent, and the guards, whose
 * mistakes have to be errors rather than rules that quietly do nothing.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { loadCatalog, resolveAgent } from "../src/config.ts";
import { cleanupScratch, tempDir } from "./scratch.ts";

afterAll(cleanupScratch);

async function scratch(): Promise<{ home: string; workspace: string }> {
	const root = await tempDir("acornfall-config-");
	const home = join(root, "home");
	const workspace = join(root, "workspace");
	await mkdir(join(workspace, ".acornfall"), { recursive: true });
	await mkdir(join(home, "agents"), { recursive: true });
	return { home, workspace };
}

async function write(path: string, content: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, content);
}

describe("the catalog", () => {
	test("reads both layers and reports which one each agent came from", async () => {
		const { home, workspace } = await scratch();
		await write(join(home, "agents", "global.md"), "---\nname: global\ndescription: from the install\n---\nBody");
		await write(
			join(workspace, ".acornfall", "agents", "local.md"),
			"---\nname: local\ndescription: from this workspace\n---\nBody",
		);

		const catalog = await loadCatalog(home, workspace, true);
		expect(catalog.agents.map((agent) => [agent.name, agent.layer])).toEqual([
			["global", "global"],
			["local", "workspace"],
		]);
	});

	test("a workspace definition shadows a global one of the same name", async () => {
		const { home, workspace } = await scratch();
		await write(join(home, "agents", "same.md"), "---\nname: same\ndescription: global\n---\nGlobal");
		await write(join(workspace, ".acornfall", "agents", "same.md"), "---\nname: same\ndescription: local\n---\nLocal");

		const catalog = await loadCatalog(home, workspace, true);
		expect(catalog.agents).toHaveLength(1);
		expect(catalog.agents[0]?.description).toBe("local");
	});

	test("an untrusted workspace contributes nothing, not even its config", async () => {
		const { home, workspace } = await scratch();
		await write(join(workspace, ".acornfall", "config.json"), `{"defaults":{"instructions":"WORKSPACE"}}`);
		await write(join(workspace, ".acornfall", "agents", "local.md"), "---\nname: local\ndescription: x\n---\nBody");
		await write(join(home, "config.json"), `{"defaults":{"instructions":"GLOBAL"}}`);

		const untrusted = await loadCatalog(home, workspace, false);
		expect(untrusted.agents).toEqual([]);
		expect(untrusted.defaults.map((layer) => layer.layer)).toEqual(["global"]);
		expect(resolveAgent(untrusted, undefined).instructions).toBe("GLOBAL");

		const trusted = await loadCatalog(home, workspace, true);
		expect(trusted.agents).toHaveLength(1);
		expect(resolveAgent(trusted, undefined).instructions).toBe("GLOBAL\n\nWORKSPACE");
	});

	test("unknown frontmatter keys are reported, never silently dropped", async () => {
		const { home, workspace } = await scratch();
		await write(join(home, "agents", "odd.md"), "---\nname: odd\ndescription: x\ncolour: blue\n---\nBody");
		const catalog = await loadCatalog(home, workspace, true);
		expect(catalog.agents[0]?.unknownKeys).toEqual(["colour"]);
	});
});

describe("folding the layers", () => {
	test("instructions concatenate in order, and the definition comes last", async () => {
		const { home, workspace } = await scratch();
		await write(join(home, "config.json"), `{"defaults":{"instructions":"GLOBAL"}}`);
		await write(join(workspace, ".acornfall", "config.json"), `{"defaults":{"instructions":"WORKSPACE"}}`);
		await write(join(workspace, ".acornfall", "agents", "one.md"), "---\nname: one\n---\nAGENT");

		const catalog = await loadCatalog(home, workspace, true);
		expect(resolveAgent(catalog, "one").instructions).toBe("GLOBAL\n\nWORKSPACE\n\nAGENT");
		expect(resolveAgent(catalog, "one").layers.map((layer) => layer.layer)).toEqual([
			"global",
			"workspace",
			"agent",
		]);
	});

	test("the last model and thinking win, the definition beating the broadest layer", async () => {
		const { home, workspace } = await scratch();
		await write(join(home, "config.json"), `{"defaults":{"model":"p/base","thinking":"low"}}`);
		await write(join(workspace, ".acornfall", "config.json"), `{"defaults":{"thinking":"high"}}`);
		await write(join(workspace, ".acornfall", "agents", "one.md"), "---\nname: one\nmodel: p/agent\n---\nBody");

		const catalog = await loadCatalog(home, workspace, true);
		const resolved = resolveAgent(catalog, "one");
		expect(resolved.model).toBe("p/agent");
		expect(resolved.thinking).toBe("high");
	});

	test("skills union, denials union, and a denial beats an allow", async () => {
		const { home, workspace } = await scratch();
		await write(join(home, "config.json"), `{"defaults":{"skills":["a"],"denyTools":["bash"]}}`);
		await write(
			join(workspace, ".acornfall", "config.json"),
			`{"defaults":{"skills":["b","a"],"allowTools":["bash","read"],"denyTools":["write"]}}`,
		);

		const catalog = await loadCatalog(home, workspace, true);
		const resolved = resolveAgent(catalog, undefined);
		expect(resolved.skills).toEqual(["a", "b"]);
		expect(resolved.denyTools?.sort()).toEqual(["bash", "write"]);
		// Listed as allowed and denied is denied: a workspace cannot widen its own tools.
		expect(resolved.allowTools).toEqual(["read"]);
	});

	test("the delegation policy is the default unless a layer overrides it", async () => {
		const { home, workspace } = await scratch();
		await write(
			join(workspace, ".acornfall", "config.json"),
			`{"defaults":{"delegation":{"spawn":false,"maxChildren":1}}}`,
		);
		const catalog = await loadCatalog(home, workspace, true);
		const resolved = resolveAgent(catalog, undefined);
		expect(resolved.delegation.spawn).toBe(false);
		expect(resolved.delegation.maxChildren).toBe(1);
		// Everything the layer did not mention keeps its default.
		expect(resolved.delegation.peers).toBe(true);
		expect(resolved.delegation.maxWakes).toBe(12);
	});

	test("`delegation: none` reads as both permissions off", async () => {
		const { home, workspace } = await scratch();
		await write(join(workspace, ".acornfall", "agents", "leaf.md"), "---\nname: leaf\ndelegation: none\n---\nBody");
		const catalog = await loadCatalog(home, workspace, true);
		const resolved = resolveAgent(catalog, "leaf");
		expect(resolved.delegation.spawn).toBe(false);
		expect(resolved.delegation.peers).toBe(false);
	});

	test("a definition that does not exist resolves to the layered defaults", async () => {
		const { home, workspace } = await scratch();
		await write(join(home, "config.json"), `{"defaults":{"instructions":"GLOBAL"}}`);
		const catalog = await loadCatalog(home, workspace, true);
		const resolved = resolveAgent(catalog, "never-heard-of-it");
		expect(resolved.name).toBe("default");
		expect(resolved.instructions).toBe("GLOBAL");
		expect(resolved.layers.map((layer) => layer.layer)).toEqual(["global"]);
	});
});

describe("guards", () => {
	test("a guard without a reason is refused: the model is told it", async () => {
		const { home, workspace } = await scratch();
		await write(
			join(workspace, ".acornfall", "config.json"),
			`{"defaults":{"hooks":{"guards":[{"tool":"bash","arg":"command","pattern":"rm -rf"}]}}}`,
		);
		expect(loadCatalog(home, workspace, true)).rejects.toThrow(/needs a reason/);
	});

	test("a guard with neither matcher is refused", async () => {
		const { home, workspace } = await scratch();
		await write(
			join(workspace, ".acornfall", "config.json"),
			`{"defaults":{"hooks":{"guards":[{"tool":"bash","arg":"command","reason":"because"}]}}}`,
		);
		expect(loadCatalog(home, workspace, true)).rejects.toThrow(/pattern or outside/);
	});

	test("a pattern that does not compile is refused where it is written", async () => {
		const { home, workspace } = await scratch();
		await write(
			join(workspace, ".acornfall", "config.json"),
			`{"defaults":{"hooks":{"guards":[{"tool":"bash","arg":"command","pattern":"([","reason":"because"}]}}}`,
		);
		expect(loadCatalog(home, workspace, true)).rejects.toThrow(/does not compile/);
	});

	test("guards accumulate: one added anywhere holds everywhere", async () => {
		const { home, workspace } = await scratch();
		await write(
			join(home, "config.json"),
			`{"defaults":{"hooks":{"guards":[{"tool":"bash","arg":"command","pattern":"sudo","reason":"global"}]}}}`,
		);
		await write(
			join(workspace, ".acornfall", "config.json"),
			`{"defaults":{"hooks":{"guards":[{"tool":"write","arg":"path","outside":true,"reason":"workspace"}]}}}`,
		);
		const catalog = await loadCatalog(home, workspace, true);
		const resolved = resolveAgent(catalog, undefined);
		expect(resolved.guards.map((guard) => guard.reason)).toEqual(["global", "workspace"]);
	});
});
