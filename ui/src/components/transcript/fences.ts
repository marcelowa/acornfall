import { escapeHtml } from "@/lib/text";

/**
 * The fences the console draws as HTML: a plan's state, a grid of results, a row of facts, a file
 * tree. They live here rather than in `render-markdown.ts` because each one has a shape to read —
 * and because a fence that does not read whole says so by returning `undefined`, which leaves the
 * caller showing the source as a code block.
 *
 * Nothing in here trusts its input: every word the model wrote is escaped, or handed to the
 * caller's inline renderer, and the result goes through the same sanitiser as a paragraph.
 */

/**
 * A plan, as the state of each of its steps: a dot and a line per step. A line that does not name
 * a state is a step that has not started, and it keeps its own words — the console does not guess
 * what the model meant.
 */
export function stepsFence(source: string, inline: InlineMarkdown): string | undefined {
	const lines = linesOf(source);
	if (lines.length === 0) return undefined;
	const rows = lines.map((line) => {
		const match = STEP.exec(line);
		const kind = match?.[1]?.toLowerCase() ?? "todo";
		const body = match?.[2] ?? line;
		return `<span class="step step-${kind}"><span class="step-dot" aria-hidden="true"></span>${inline(body)}</span>`;
	});
	return `<div class="steps">${rows.join("")}</div>`;
}

/**
 * A grid of results, `label | cell | cell` per line, with the column names on the first line. A
 * cell holds one word from the state vocabulary and wears its colour, so a reader sees where the
 * failures are down a column without reading a word of them.
 *
 * The grid has to line up — every row the same number of cells, every cell a state the console
 * knows — because a grid with a hole in it is a grid that lies about the shape.
 */
export function matrixFence(source: string): string | undefined {
	const rows = linesOf(source).map((line) => line.split("|").map((cell) => cell.trim()));
	const [head, ...body] = rows;
	if (head === undefined || body.length === 0) return undefined;
	if (head.length < 2 || head.length > MAX_COLUMNS || body.length > MAX_ROWS) return undefined;
	const states = body.map((cells) =>
		cells.slice(1).map((cell) => MATRIX_STATES[cell.toLowerCase()]),
	);
	if (
		body.some((cells) => cells.length !== head.length) ||
		states.some((cells) => cells.some((state) => state === undefined))
	)
		return undefined;

	const headRow = row(
		"",
		head.map((cell) => `<span class="matrix-cell">${escapeHtml(cell)}</span>`),
		true,
	);
	const bodyRows = body.map((cells, index) =>
		row(
			cells[0] ?? "",
			(states[index] ?? []).map(
				(state, column) =>
					`<span class="matrix-cell cell-${state}">${escapeHtml(cells[column + 1] ?? "")}</span>`,
			),
		),
	);
	return `<div class="matrix">${headRow}${bodyRows.join("")}</div>`;
}

/**
 * A row of facts: `name: value` per line, each pair a tile. The console's own facts (a commit, a
 * size, a token count) read better as tiles than as a sentence, and a value is text, not a number:
 * `+414 −75` is a fact like any other.
 */
export function statsFence(source: string): string | undefined {
	const lines = linesOf(source);
	if (lines.length === 0 || lines.length > MAX_STATS) return undefined;
	const tiles: string[] = [];
	for (const line of lines) {
		const at = line.indexOf(":");
		const label = at < 0 ? "" : line.slice(0, at).trim();
		const value = at < 0 ? "" : line.slice(at + 1).trim();
		if (label === "" || value === "") return undefined;
		tiles.push(
			`<span class="stat"><span class="stat-label">${escapeHtml(label)}</span><span class="stat-value">${escapeHtml(value)}</span></span>`,
		);
	}
	return `<div class="stats">${tiles.join("")}</div>`;
}

/**
 * A file tree out of the paths it lists: shared segments become one directory and its children,
 * which is the shape a wall of paths hides. A directory keeps its trailing slash, and the indent
 * is the reader's guide.
 */
export function treeFence(source: string): string | undefined {
	const paths = linesOf(source)
		.map((line) => line.replace(/^\.\//, ""))
		.filter((line) => line !== "");
	if (paths.length === 0 || paths.length > MAX_PATHS) return undefined;

	const root: TreeNode = { name: "", directory: true, children: new Map() };
	for (const path of paths) {
		const named = path.endsWith("/");
		const segments = path
			.replace(/\/+$/, "")
			.split("/")
			.filter((segment) => segment !== "");
		if (segments.length === 0) return undefined;
		let node = root;
		for (const segment of segments) {
			let child = node.children.get(segment);
			if (child === undefined) {
				child = { name: segment, directory: false, children: new Map() };
				node.children.set(segment, child);
			}
			node = child;
		}
		// A path that ends in a slash is a directory even when another line named a file under it.
		if (named) node.directory = true;
	}
	return `<div class="tree">${branches(root.children)}</div>`;
}

function branches(nodes: ReadonlyMap<string, TreeNode>): string {
	return [...nodes.values()]
		.map((node) => {
			// A node with children is a directory whatever the paths said: the shape says so.
			const directory = node.children.size > 0 || node.directory;
			const name = escapeHtml(node.name) + (directory ? "/" : "");
			const label = `<div class="tree-node ${directory ? "tree-dir" : "tree-file"}" title="${name}">${name}</div>`;
			if (node.children.size === 0) return label;
			return `${label}<div class="tree-children">${branches(node.children)}</div>`;
		})
		.join("");
}

/** One row of a matrix: its label, then its cells. The head row has no label and no state. */
function row(label: string, cells: readonly string[], head = false): string {
	const classes = head ? "matrix-row matrix-head" : "matrix-row";
	return `<div class="${classes}"><span class="matrix-label" title="${escapeHtml(label)}">${escapeHtml(label)}</span>${cells.join("")}</div>`;
}

/** A fence's lines, without the blank ones. */
function linesOf(source: string): string[] {
	return source
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "");
}

/** A step's words, with inline markdown: a command in a step is still a command. */
export type InlineMarkdown = (text: string) => string;

/** A plan's state, one step per line: `doing: build it`. */
const STEP = /^(done|doing|blocked|todo):[ \t]*(.*)$/i;

/** What a matrix cell can say, and the colour it wears. A word outside this list is not a state. */
const MATRIX_STATES: Record<string, "ok" | "warn" | "fail" | "unknown"> = {
	ok: "ok",
	pass: "ok",
	passed: "ok",
	done: "ok",
	yes: "ok",
	good: "ok",
	warn: "warn",
	warning: "warn",
	skip: "warn",
	skipped: "warn",
	partial: "warn",
	flaky: "warn",
	fail: "fail",
	failed: "fail",
	error: "fail",
	broken: "fail",
	no: "fail",
	unknown: "unknown",
	"n/a": "unknown",
	na: "unknown",
	"-": "unknown",
	"?": "unknown",
	none: "unknown",
	todo: "unknown",
	pending: "unknown",
};

/** Past these the drawing is not a glance any more, and the source is the better answer. */
const MAX_COLUMNS = 8;
const MAX_ROWS = 12;
const MAX_STATS = 12;
const MAX_PATHS = 40;

interface TreeNode {
	name: string;
	directory: boolean;
	children: Map<string, TreeNode>;
}
