// Guards the no-build-step client: every el("id") lookup must exist in the
// markup. Run with `make check`.
import { readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const web = join(here, "..", "gateway", "web");

const [js, html] = await Promise.all([
	readFile(join(web, "app.js"), "utf8"),
	readFile(join(web, "index.html"), "utf8"),
]);

const referenced = [...js.matchAll(/\bel\("([^"]+)"\)/g)].map((match) => match[1]);
const declared = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]));

const missing = [...new Set(referenced)].filter((id) => !declared.has(id));
if (missing.length > 0) {
	console.error(`index.html is missing: ${missing.map((id) => `#${id}`).join(", ")}`);
	process.exit(1);
}
console.log(`client check ok: ${new Set(referenced).size} element lookups resolve`);
