// Tests the context inspector's fold against real system entries.
//
// The client has no build step, so there is nothing to import: the module is
// evaluated once with a DOM stub, and the pure function is captured. Fixtures
// are copied verbatim from a live conversation (three system entries: a base
// snapshot, then an instructions patch, then a tool patch).
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const source = await readFile(join(here, "..", "gateway", "web", "app.js"), "utf8");

/** Minimal DOM so the module can evaluate; only the fold is exercised. */
const node = () => ({
	addEventListener() {},
	querySelectorAll: () => [],
	appendChild() {},
	set innerHTML(_value) {},
	get innerHTML() {
		return "";
	},
	textContent: "",
	style: { setProperty() {} },
	dataset: {},
	hidden: false,
	focus() {},
	setSelectionRange() {},
	classList: { add() {}, remove() {}, toggle() {} },
});

const global = globalThis;
global.document = {
	getElementById: node,
	addEventListener() {},
	querySelector: node,
	querySelectorAll: () => [],
	documentElement: node(),
};
global.localStorage = {
	getItem: () => null,
	setItem() {},
};
global.getComputedStyle = () => ({ getPropertyValue: () => "" });
global.fetch = () => new Promise(() => {});
global.EventSource = class {
	addEventListener() {}
	close() {}
};
global.setInterval = () => 0;

const capture = new Function(`${source}\nreturn { contextHistory, lastUsage };`);
const { contextHistory, lastUsage } = capture();

const entries = [
	{
		id: 10,
		kind: "pi.system",
		model: [
			{
				role: "system",
				content: "",
				sections: { skills: "skills text", preamble: "preamble text", cwd: "<cwd>\n/acornfall\n</cwd>" },
				toolsAdded: [
					{ name: "read", description: "read a file", parameters: { type: "object" } },
					{ name: "write", description: "write a file", parameters: { type: "object" } },
					{ name: "edit", description: "edit a file", parameters: { type: "object" } },
					{ name: "bash", description: "run a command", parameters: { type: "object" } },
					{ name: "skill", description: "load a skill", parameters: { type: "object" } },
				],
			},
		],
	},
	{
		id: 71,
		kind: "pi.system",
		model: [{ role: "system", content: "", sections: { instructions: "global + workspace + agent" } }],
	},
	{
		id: 92,
		kind: "pi.system",
		model: [{ role: "system", content: "", sections: { instructions: "edited" }, toolsRemoved: [{ name: "write" }, { name: "edit" }] }],
	},
	{ id: 93, kind: "pi.assistant", model: [{ role: "assistant", content: [], usage: { input: 100, output: 20, cacheRead: 5, cacheWrite: 0 } }] },
];

const history = contextHistory(entries);
const failures = [];
const check = (label, actual, expected) => {
	const a = JSON.stringify(actual);
	const e = JSON.stringify(expected);
	if (a !== e) failures.push(`${label}\n    expected ${e}\n    actual   ${a}`);
};

check("one request per system entry", history.length, 3);
check("first request sections", [...history[0].sections.keys()], ["skills", "preamble", "cwd"]);
check("first request tools", [...history[0].tools.keys()], ["read", "write", "edit", "bash", "skill"]);
check("first request is marked as first", history[0].previousId, null);

// A patch that carries only the changed section must fold forward, not replace.
check("second request keeps the base sections", [...history[1].sections.keys()], ["skills", "preamble", "cwd", "instructions"]);
check("second request adds the instructions section", history[1].changes.sectionsAdded, ["instructions"]);
check("an added section is not also reported as changed", history[1].changes.sectionsChanged, []);
check("second request adds no tools", history[1].changes.toolsAdded, []);

check("third request reports the edited section", history[2].changes.sectionsChanged, ["instructions"]);

check("third request tools exclude the denied ones", [...history[2].tools.keys()], ["read", "bash", "skill"]);
check("third request tool delta", history[2].changes.toolsRemoved, ["write", "edit"]);
check("third request still sees the patched section", history[2].sections.get("instructions"), "edited");

check("usage comes from the latest assistant entry", lastUsage(entries), { input: 100, output: 20, cacheRead: 5, cacheWrite: 0 });

// A section removed by a null patch disappears from later requests.
const removed = contextHistory([
	...entries.slice(0, 1),
	{ id: 30, kind: "pi.system", model: [{ role: "system", content: "", sections: { skills: null } }] },
]);
check("null removes a section", [...removed[1].sections.keys()], ["preamble", "cwd"]);
check("removal is reported as a change", removed[1].changes.sectionsRemoved, ["skills"]);

if (failures.length > 0) {
	console.error(`context inspector fold failed:\n  - ${failures.join("\n  - ")}`);
	process.exit(1);
}
console.log(`context check ok: ${history.length} requests folded, ${history[2].tools.size} tools after filtering`);
