// The rules no linter owns, checked where they are cheapest to fix: in the tree.
//
// `docs/engineering/standards.md` names this script as the mechanism for both, because a rule
// with no check is a preference. Each is absolute on purpose — there is one `init()` question
// and one exception format — so a failure is a decision someone has to make, not a threshold.
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join, relative } from "node:path";

const root = fileURLToPath(new URL("..", import.meta.url));

const rules = [
	{
		what: "init() is not for setup (G3)",
		hint: "it runs before main and decides something the program did not ask for",
		trees: ["gateway"],
		files: /\.go$/,
		matches: /^\s*func init\(\)/,
	},
	{
		what: "a lint exception carries its reason (S9)",
		hint: 'write it after " -- " on the same line, so the next reader knows what was traded',
		trees: ["worker/src", "worker/test"],
		files: /\.ts$/,
		matches: /(eslint|oxlint)-disable/,
		exempt: / -- /,
	},
];

async function sources(tree) {
	const entries = await readdir(join(root, tree), { recursive: true, withFileTypes: true });
	return entries
		.filter((entry) => entry.isFile())
		.map((entry) => join(entry.parentPath ?? entry.path, entry.name));
}

const failures = [];
for (const rule of rules) {
	for (const tree of rule.trees) {
		for (const path of await sources(tree)) {
			if (!rule.files.test(path)) continue;
			const lines = (await readFile(path, "utf8")).split("\n");
			lines.forEach((line, index) => {
				if (!rule.matches.test(line)) return;
				if (rule.exempt !== undefined && rule.exempt.test(line)) return;
				failures.push(`${relative(root, path)}:${index + 1}  ${rule.what}\n    ${line.trim()}\n    ${rule.hint}`);
			});
		}
	}
}

// The engine pin lives in two languages and must stay one value: the CLI and the
// SDK share the store, including its migrations, so a drift migrates the catalog
// past what the other side reads (2026-10-11: 0.7.7 rowed it forward, 0.7.6 blind).
const pinFiles = [
	["gateway/internal/sandbox/microsandbox.go", /const Version = "(\d+\.\d+\.\d+)"/],
	["worker/src/microsandbox.ts", /export const ENGINE_VERSION = "(\d+\.\d+\.\d+)"/],
];
const pins = new Map();
for (const [file, pattern] of pinFiles) {
	const text = await readFile(join(root, file), "utf8");
	const match = text.match(pattern);
	if (match !== null) pins.set(file, match[1]);
}
const distinct = new Set(pins.values());
if (pins.size !== pinFiles.length || distinct.size !== 1) {
	failures.push(
		`engine pin drifted: ${[...pins].map(([file, version]) => `${file}=${version}`).join(", ") || "unreadable"}\n    the gateway and the worker share the engine store; pin both to one release`,
	);
}

if (failures.length > 0) {
	console.error(`house rules:\n  - ${failures.join("\n  - ")}`);
	process.exit(1);
}
console.log(`house rules: ${rules.length + 1} checked, clean`);
