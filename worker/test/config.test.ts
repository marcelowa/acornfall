/**
 * The resource overlay: three layers folding into one resolved agent, and the guards, whose
 * mistakes have to be errors rather than rules that quietly do nothing.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdir } from "node:fs/promises";
import { join } from "node:path";
import { layerRoots, loadCatalog, resolveAgent, type LayerRoots } from "../src/config.ts";
import { cleanupScratch, tempDir, write } from "./scratch.ts";
import { hostFiles } from "../src/files.ts";

afterAll(cleanupScratch);

async function scratch(): Promise<{ root: string; workspace: string }> {
	const base = await tempDir("acornfall-config-");
	// The root is the folder the machine mounts (ADR 0022): the bundle holds the resources, and
	// config beside it holds the install's settings.
	const root = join(base, "acornfall");
	const workspace = join(base, "workspace");
	await mkdir(join(root, ".agents", "agents"), { recursive: true });
	await mkdir(join(root, "config"), { recursive: true });
	await mkdir(join(workspace, ".acornfall"), { recursive: true });
	return { root, workspace };
}

/** The roots as the worker builds them: one bundle, and the config folder beside it. */
function rootsOf(parts: { root: string; workspace: string }): LayerRoots {
	return layerRoots({ share: parts.root, workspace: parts.workspace });
}

describe("the catalog", () => {
	test("reads both layers and reports which one each agent came from", async () => {
		const { root, workspace } = await scratch();
		await write(
			join(root, ".agents", "agents", "global.md"),
			"---\nname: global\ndescription: from the install\n---\nBody",
		);
		await write(
			join(workspace, ".acornfall", "agents", "local.md"),
			"---\nname: local\ndescription: from this workspace\n---\nBody",
		);

		const catalog = await loadCatalog(rootsOf({ root, workspace }), hostFiles);
		expect(catalog.agents.map((agent) => [agent.name, agent.layer])).toEqual([
			["general", "built-in"],
			["global", "global"],
			["local", "workspace"],
		]);
	});

	test("a workspace definition shadows a global one of the same name", async () => {
		const { root, workspace } = await scratch();
		await write(
			join(root, ".agents", "agents", "same.md"),
			"---\nname: same\ndescription: global\n---\nGlobal",
		);
		await write(
			join(workspace, ".acornfall", "agents", "same.md"),
			"---\nname: same\ndescription: local\n---\nLocal",
		);

		const catalog = await loadCatalog(rootsOf({ root, workspace }), hostFiles);
		expect(catalog.agents.map((agent) => agent.name)).toEqual(["general", "same"]);
		expect(catalog.agents.find((agent) => agent.name === "same")?.description).toBe("local");
	});

	// A workspace used to carry a trust flag that decided whether any of this was read. It is
	// read unconditionally now: the folder the agent works in is the folder it takes
	// instructions from, and what an agent may *touch* is the sandbox's business.
	test("a workspace's own config and definitions are read", async () => {
		const { root, workspace } = await scratch();
		await write(
			join(workspace, ".acornfall", "config.json"),
			`{"defaults":{"instructions":"WORKSPACE"}}`,
		);
		await write(
			join(workspace, ".acornfall", "agents", "local.md"),
			"---\nname: local\ndescription: x\n---\nBody",
		);
		await write(join(root, "config", "config.json"), `{"defaults":{"instructions":"GLOBAL"}}`);

		const catalog = await loadCatalog(rootsOf({ root, workspace }), hostFiles);
		expect(catalog.agents.map((agent) => agent.name)).toEqual(["general", "local"]);
		expect(catalog.defaults.map((layer) => layer.layer)).toEqual(["global", "workspace"]);
		expect(resolveAgent(catalog, undefined).instructions).toBe("GLOBAL\n\nWORKSPACE");
	});

	test("the general agent is always in the catalog, and a general.md replaces it", async () => {
		const { root, workspace } = await scratch();
		const catalog = await loadCatalog(rootsOf({ root, workspace }), hostFiles);
		expect(catalog.agents.map((agent) => [agent.name, agent.layer])).toEqual([
			["general", "built-in"],
		]);
		// It resolves like any other agent, and it has no file layer to explain.
		expect(resolveAgent(catalog, "general").name).toBe("general");
		expect(resolveAgent(catalog, "general").layers).toEqual([]);

		await write(
			join(root, ".agents", "agents", "general.md"),
			"---\nname: general\ndescription: mine\n---\nBe brief.",
		);
		const shadowed = await loadCatalog(rootsOf({ root, workspace }), hostFiles);
		expect(shadowed.agents.map((agent) => [agent.name, agent.layer])).toEqual([
			["general", "global"],
		]);
		expect(resolveAgent(shadowed, "general").description).toBe("mine");
	});

	test("unknown frontmatter keys are reported, never silently dropped", async () => {
		const { root, workspace } = await scratch();
		await write(
			join(root, ".agents", "agents", "odd.md"),
			"---\nname: odd\ndescription: x\ncolour: blue\n---\nBody",
		);
		const catalog = await loadCatalog(rootsOf({ root, workspace }), hostFiles);
		expect(catalog.agents.find((agent) => agent.name === "odd")?.unknownKeys).toEqual([
			"colour",
		]);
	});
});

describe("folding the layers", () => {
	test("instructions concatenate in order, and the definition comes last", async () => {
		const { root, workspace } = await scratch();
		await write(join(root, "config", "config.json"), `{"defaults":{"instructions":"GLOBAL"}}`);
		await write(
			join(workspace, ".acornfall", "config.json"),
			`{"defaults":{"instructions":"WORKSPACE"}}`,
		);
		await write(
			join(workspace, ".acornfall", "agents", "one.md"),
			"---\nname: one\n---\nAGENT",
		);

		const catalog = await loadCatalog(rootsOf({ root, workspace }), hostFiles);
		expect(resolveAgent(catalog, "one").instructions).toBe("GLOBAL\n\nWORKSPACE\n\nAGENT");
		expect(resolveAgent(catalog, "one").layers.map((layer) => layer.layer)).toEqual([
			"global",
			"workspace",
			"agent",
		]);
	});

	test("the last model and thinking win, the definition beating the broadest layer", async () => {
		const { root, workspace } = await scratch();
		await write(
			join(root, "config", "config.json"),
			`{"defaults":{"model":"p/base","thinking":"low"}}`,
		);
		await write(
			join(workspace, ".acornfall", "config.json"),
			`{"defaults":{"thinking":"high"}}`,
		);
		await write(
			join(workspace, ".acornfall", "agents", "one.md"),
			"---\nname: one\nmodel: p/agent\n---\nBody",
		);

		const catalog = await loadCatalog(rootsOf({ root, workspace }), hostFiles);
		const resolved = resolveAgent(catalog, "one");
		expect(resolved.model).toBe("p/agent");
		expect(resolved.thinking).toBe("high");
	});

	test("skills union, denials union, and a denial beats an allow", async () => {
		const { root, workspace } = await scratch();
		await write(
			join(root, "config", "config.json"),
			`{"defaults":{"skills":["a"],"denyTools":["bash"]}}`,
		);
		await write(
			join(workspace, ".acornfall", "config.json"),
			`{"defaults":{"skills":["b","a"],"allowTools":["bash","read"],"denyTools":["write"]}}`,
		);

		const catalog = await loadCatalog(rootsOf({ root, workspace }), hostFiles);
		const resolved = resolveAgent(catalog, undefined);
		expect(resolved.skills).toEqual(["a", "b"]);
		expect(resolved.denyTools?.sort()).toEqual(["bash", "write"]);
		// Listed as allowed and denied is denied: a workspace cannot widen its own tools.
		expect(resolved.allowTools).toEqual(["read"]);
	});

	test("the delegation policy is the default unless a layer overrides it", async () => {
		const { root, workspace } = await scratch();
		await write(
			join(workspace, ".acornfall", "config.json"),
			`{"defaults":{"delegation":{"child":false,"maxChildren":1}}}`,
		);
		const catalog = await loadCatalog(rootsOf({ root, workspace }), hostFiles);
		const resolved = resolveAgent(catalog, undefined);
		expect(resolved.delegation.child).toBe(false);
		expect(resolved.delegation.maxChildren).toBe(1);
		// Everything the layer did not mention keeps its default.
		expect(resolved.delegation.peer).toBe(true);
		expect(resolved.delegation.maxWakes).toBe(12);
	});

	test("`delegation: none` reads as both permissions off", async () => {
		const { root, workspace } = await scratch();
		await write(
			join(workspace, ".acornfall", "agents", "leaf.md"),
			"---\nname: leaf\ndelegation: none\n---\nBody",
		);
		const catalog = await loadCatalog(rootsOf({ root, workspace }), hostFiles);
		const resolved = resolveAgent(catalog, "leaf");
		expect(resolved.delegation.child).toBe(false);
		expect(resolved.delegation.peer).toBe(false);
	});

	test("the list grants what it names and denies the unnamed one", async () => {
		const cases = [
			{ delegation: "child", child: true, peer: false },
			{ delegation: "peer", child: false, peer: true },
			{ delegation: "child, peer", child: true, peer: true },
			{ delegation: "peer, child", child: true, peer: true },
			{ delegation: "all", child: true, peer: true },
		] as const;
		for (const testCase of cases) {
			const { root, workspace } = await scratch();
			await write(
				join(workspace, ".acornfall", "agents", "one.md"),
				`---\nname: one\ndelegation: ${testCase.delegation}\n---\nBody`,
			);
			const catalog = await loadCatalog(rootsOf({ root, workspace }), hostFiles);
			const resolved = resolveAgent(catalog, "one");
			expect(resolved.delegation.child).toBe(testCase.child);
			expect(resolved.delegation.peer).toBe(testCase.peer);
		}
	});

	test("an unknown delegation word is refused, naming what it got", async () => {
		const { root, workspace } = await scratch();
		await write(
			join(workspace, ".acornfall", "agents", "one.md"),
			"---\nname: one\ndelegation: both\n---\nBody",
		);
		expect(loadCatalog(rootsOf({ root, workspace }), hostFiles)).rejects.toThrow(
			/unknown delegation "both"/,
		);
	});

	test("an empty list states no opinion, so the defaults stand", async () => {
		const { root, workspace } = await scratch();
		await write(
			join(workspace, ".acornfall", "agents", "one.md"),
			"---\nname: one\ndelegation:\n---\nBody",
		);
		const catalog = await loadCatalog(rootsOf({ root, workspace }), hostFiles);
		const resolved = resolveAgent(catalog, "one");
		expect(resolved.delegation.child).toBe(true);
		expect(resolved.delegation.peer).toBe(true);
	});

	test("an unknown delegation key in config is refused", async () => {
		const { root, workspace } = await scratch();
		await write(
			join(workspace, ".acornfall", "config.json"),
			`{"defaults":{"delegation":{"spawn":false}}}`,
		);
		expect(loadCatalog(rootsOf({ root, workspace }), hostFiles)).rejects.toThrow(
			/unknown delegation key "spawn"/,
		);
	});

	test("a definition that does not exist resolves to the layered defaults", async () => {
		const { root, workspace } = await scratch();
		await write(join(root, "config", "config.json"), `{"defaults":{"instructions":"GLOBAL"}}`);
		const catalog = await loadCatalog(rootsOf({ root, workspace }), hostFiles);
		const resolved = resolveAgent(catalog, "never-heard-of-it");
		expect(resolved.name).toBe("general");
		expect(resolved.instructions).toBe("GLOBAL");
		expect(resolved.layers.map((layer) => layer.layer)).toEqual(["global"]);
	});
});

describe("guards", () => {
	test("a guard without a reason is refused: the model is told it", async () => {
		const { root, workspace } = await scratch();
		await write(
			join(workspace, ".acornfall", "config.json"),
			`{"defaults":{"hooks":{"guards":[{"tool":"bash","arg":"command","pattern":"rm -rf"}]}}}`,
		);
		expect(loadCatalog(rootsOf({ root, workspace }), hostFiles)).rejects.toThrow(
			/needs a reason/,
		);
	});

	test("a guard with neither matcher is refused", async () => {
		const { root, workspace } = await scratch();
		await write(
			join(workspace, ".acornfall", "config.json"),
			`{"defaults":{"hooks":{"guards":[{"tool":"bash","arg":"command","reason":"because"}]}}}`,
		);
		expect(loadCatalog(rootsOf({ root, workspace }), hostFiles)).rejects.toThrow(
			/pattern or outside/,
		);
	});

	test("a pattern that does not compile is refused where it is written", async () => {
		const { root, workspace } = await scratch();
		await write(
			join(workspace, ".acornfall", "config.json"),
			`{"defaults":{"hooks":{"guards":[{"tool":"bash","arg":"command","pattern":"([","reason":"because"}]}}}`,
		);
		expect(loadCatalog(rootsOf({ root, workspace }), hostFiles)).rejects.toThrow(
			/does not compile/,
		);
	});

	test("reads the ecosystem's .agents folder, not only ours", async () => {
		const { root, workspace } = await scratch();
		await write(
			join(workspace, ".agents", "config.json"),
			`{"defaults":{"instructions":"ECOSYSTEM"}}`,
		);
		await write(
			join(workspace, ".agents", "agents", "shared.md"),
			"---\nname: shared\ndescription: from .agents\n---\nBody",
		);

		const catalog = await loadCatalog(rootsOf({ root, workspace }), hostFiles);
		expect(catalog.agents.map((agent) => [agent.name, agent.layer])).toEqual([
			["general", "built-in"],
			["shared", "workspace"],
		]);
		// The explain view names the file that won, so `.agents` is visibly where it came from.
		expect(catalog.agents.find((agent) => agent.name === "shared")?.source).toContain(
			"/.agents/",
		);
		expect(resolveAgent(catalog, undefined).instructions).toBe("ECOSYSTEM");
	});

	test("the workspace shadows the install, and ours beside it", async () => {
		const { root, workspace } = await scratch();
		// The same file in the places it can live: the install's bundle, then the workspace's two
		// folders, with ours winning. There is no user layer any more — the bundle *is* the user's
		// (ADR 0022), so there is nothing to shadow at the top.
		await write(
			join(root, ".agents", "agents", "same.md"),
			"---\nname: same\ndescription: install\n---\nInstall",
		);
		await write(
			join(workspace, ".agents", "agents", "same.md"),
			"---\nname: same\ndescription: ecosystem\n---\nEco",
		);
		await write(
			join(workspace, ".acornfall", "agents", "same.md"),
			"---\nname: same\ndescription: native\n---\nNative",
		);
		await write(
			join(root, ".agents", "config.json"),
			`{"defaults":{"instructions":"INSTALL BUNDLE"}}`,
		);
		await write(
			join(workspace, ".agents", "config.json"),
			`{"defaults":{"instructions":"WORKSPACE ECOSYSTEM"}}`,
		);
		await write(
			join(workspace, ".acornfall", "config.json"),
			`{"defaults":{"instructions":"WORKSPACE NATIVE"}}`,
		);

		const catalog = await loadCatalog(rootsOf({ root, workspace }), hostFiles);
		expect(catalog.agents).toHaveLength(2);
		expect(catalog.agents.find((agent) => agent.name === "same")?.description).toBe("native");
		// Instructions concatenate in the order the folders are read, so ours is last and wins
		// for anything that takes the last value.
		expect(resolveAgent(catalog, undefined).instructions).toBe(
			"INSTALL BUNDLE\n\nWORKSPACE ECOSYSTEM\n\nWORKSPACE NATIVE",
		);
		expect(catalog.defaults.map((layer) => layer.path)).toEqual([
			join(root, ".agents", "config.json"),
			join(workspace, ".agents", "config.json"),
			join(workspace, ".acornfall", "config.json"),
		]);
	});

	test("the workspace's ecosystem folder is read as well as ours", async () => {
		const { root, workspace } = await scratch();
		await write(
			join(workspace, ".agents", "agents", "eco.md"),
			"---\nname: eco\ndescription: x\n---\nBody",
		);
		await write(
			join(workspace, ".agents", "config.json"),
			`{"defaults":{"instructions":"ECOSYSTEM"}}`,
		);
		await write(join(root, "config", "config.json"), `{"defaults":{"instructions":"INSTALL"}}`);

		const catalog = await loadCatalog(rootsOf({ root, workspace }), hostFiles);
		expect(catalog.agents.map((agent) => agent.name)).toEqual(["eco", "general"]);
		expect(catalog.defaults.map((layer) => layer.layer)).toEqual(["global", "workspace"]);
		expect(resolveAgent(catalog, undefined).instructions).toBe("INSTALL\n\nECOSYSTEM");
	});

	test("guards accumulate: one added anywhere holds everywhere", async () => {
		const { root, workspace } = await scratch();
		await write(
			join(root, "config", "config.json"),
			`{"defaults":{"hooks":{"guards":[{"tool":"bash","arg":"command","pattern":"sudo","reason":"global"}]}}}`,
		);
		await write(
			join(workspace, ".acornfall", "config.json"),
			`{"defaults":{"hooks":{"guards":[{"tool":"write","arg":"path","outside":true,"reason":"workspace"}]}}}`,
		);
		const catalog = await loadCatalog(rootsOf({ root, workspace }), hostFiles);
		const resolved = resolveAgent(catalog, undefined);
		expect(resolved.guards.map((guard) => guard.reason)).toEqual(["global", "workspace"]);
	});
});
