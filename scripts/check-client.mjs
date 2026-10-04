// Guards the no-build-step client: every el("id") lookup must exist in the
// markup. Run with `make check`.
import { readFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..", "gateway", "web");

// Syntax first: a stray brace is not a lookup failure and must not reach a browser.
try {
	await run(process.execPath, ["--check", join(web, "app.js")]);
} catch (error) {
	const detail = String(error.stderr ?? error.message)
		.split("\n")
		.filter((line) => line.includes("SyntaxError") || line.includes("app.js:"))
		.join("\n");
	console.error(`app.js does not parse:\n${detail}`);
	process.exit(1);
}

const [js, html, css] = await Promise.all([
	readFile(join(web, "app.js"), "utf8"),
	readFile(join(web, "index.html"), "utf8"),
	readFile(join(web, "style.css"), "utf8"),
]);

const referenced = [...js.matchAll(/\bel\("([^"]+)"\)/g)].map((match) => match[1]);
const declared = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));

const missing = [...new Set(referenced)].filter((id) => !declared.has(id));
if (missing.length > 0) {
	console.error(`index.html is missing: ${missing.map((id) => `#${id}`).join(", ")}`);
	process.exit(1);
}

// An author `display` rule beats the user-agent [hidden] rule, so an element that
// ships hidden stays visible unless the stylesheet says otherwise. That is a
// silent failure: the markup looks right and the modal never goes away.
const hidesByAttribute = /\[hidden\][^{]*\{[^}]*display:\s*none/.test(css);
const usesHidden = /\shidden(\s|>)/.test(html);
if (usesHidden && !hidesByAttribute) {
	console.error("index.html uses the hidden attribute but style.css has no [hidden] { display: none } rule");
	process.exit(1);
}

console.log(`client check ok: ${new Set(referenced).size} element lookups resolve`);
