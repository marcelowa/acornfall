// Vendors the client's third-party browser code into gateway/web/vendor.
//
// The client itself has no build step, so these bundles are committed. They are
// generated rather than hand-copied so the versions live in package.json and
// bun.lock, and regenerating is one command: `make vendor`.
//
// Run with: bun run tools/vendor.mjs
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const out = join(here, "..", "gateway", "web", "vendor");
const modules = join(here, "node_modules");

await mkdir(out, { recursive: true });

// marked and DOMPurify ship browser ESM builds already.
const copies = [
	["marked/lib/marked.esm.js", "marked.js"],
	["dompurify/dist/purify.es.mjs", "dompurify.js"],
	["highlight.js/styles/github-dark.min.css", "highlight.css"],
];
for (const [from, to] of copies) {
	await copyFile(join(modules, from), join(out, to));
}

// highlight.js ships ES modules that import their language files, so it needs
// bundling. The common set covers roughly three dozen languages at 168 KB.
const build = Bun.spawn(
	[
		"bun",
		"build",
		join(modules, "highlight.js/es/common.js"),
		"--target=browser",
		"--format=esm",
		"--minify",
		`--outfile=${join(out, "highlight.js")}`,
	],
	{ stdout: "pipe", stderr: "pipe" },
);
if ((await build.exited) !== 0) {
	console.error(await new Response(build.stderr).text());
	process.exit(1);
}

const sizes = [];
for (const [, to] of copies.concat([["highlight.js", "highlight.js"]])) {
	const path = join(out, to);
	const bytes = (await readFile(path, "utf8")).length;
	sizes.push(`${to} ${(bytes / 1024).toFixed(0)} KB`);
}
// A header makes it obvious these are generated and where they came from.
for (const file of ["marked.js", "dompurify.js", "highlight.js"]) {
	const path = join(out, file);
	const body = await readFile(path, "utf8");
	await writeFile(path, `/* vendored by tools/vendor.mjs — do not edit */\n${body}`);
}

console.log(`vendored into gateway/web/vendor: ${sizes.join(", ")}`);
