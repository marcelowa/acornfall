/**
 * A small Markdown renderer for assistant replies.
 *
 * Security: the source is HTML-escaped first, and every later step operates on the
 * escaped text. Model output and tool output are untrusted — a tool result can
 * contain anything a file or a command produced — so raw HTML must never survive,
 * and link targets are scheme-checked rather than passed through.
 *
 * Scope is deliberately a subset: fenced code, headings, lists, tables,
 * blockquotes, rules, links, emphasis, inline code. Single newlines render as
 * line breaks, which is the chat convention rather than the Markdown one: models
 * write short lines and joining them reads worse.
 */

const ENTITIES = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };

export function escapeHtml(value) {
	return String(value ?? "").replace(/[&<>"']/g, (char) => ENTITIES[char]);
}

/** Terminal output arrives with colour codes; they render as noise in a browser. */
export function stripAnsi(text) {
	return String(text ?? "").replace(
		// eslint-disable-next-line no-control-regex
		/[\u001b\u009b][[()#;?]*(?:\d{1,4}(?:;\d{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
		"",
	);
}

const SAFE_SCHEMES = /^(https?:|mailto:)/i;

/** Returns a usable href, or null when the target is not something to click. */
function safeUrl(raw) {
	const url = raw.trim();
	if (url === "") return null;
	if (url.startsWith("#") || url.startsWith("/")) return url;
	return SAFE_SCHEMES.test(url) ? url : null;
}

/** Inline formatting, applied to already-escaped text. */
function inline(text) {
	// Code spans are split out first so their contents are never reformatted.
	return text
		.split(/(`[^`\n]+`)/g)
		.map((part) => {
			if (part.length > 2 && part.startsWith("`") && part.endsWith("`")) {
				return `<code>${part.slice(1, -1)}</code>`;
			}
			let out = part;
			// [label](target) — a rejected target keeps the label, drops the link.
			out = out.replace(/\[([^\]\n]*)\]\(([^)\s]+)(?:\s+&quot;[^)]*&quot;)?\)/g, (match, label, href) => {
				const safe = safeUrl(href);
				return safe === null ? label : `<a href="${safe}" target="_blank" rel="noreferrer">${label}</a>`;
			});
			// Bare URLs. Safe to run after the pass above: the character before a
			// generated href or link text is never whitespace or a bracket.
			out = out.replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, (match, prefix, url) => {
				return `${prefix}<a href="${url}" target="_blank" rel="noreferrer">${url}</a>`;
			});
			out = out.replace(/\*\*([^\n]+?)\*\*/g, "<strong>$1</strong>");
			out = out.replace(/(^|[^*\w])\*([^*\n]+?)\*/g, "$1<em>$2</em>");
			out = out.replace(/(^|[^_\w])_([^_\n]+?)_(?=[^\w]|$)/g, "$1<em>$2</em>");
			out = out.replace(/~~([^\n]+?)~~/g, "<del>$1</del>");
			return out;
		})
		.join("");
}

const ITEM = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;
const HEADING = /^(#{1,6})\s+(.*)$/;
const FENCE = /^\s*(```+|~~~+)\s*([\w+#.-]*)\s*$/;
const RULE = /^\s*(?:[-*_]\s*){3,}$/;
const QUOTE = /^\s*&gt;\s?(.*)$/;
const SEPARATOR = /^\s*\|?\s*:?-{1,}:?\s*(?:\|\s*:?-{1,}:?\s*)*\|?\s*$/;

const isTableStart = (lines, index) =>
	lines[index]?.includes("|") === true &&
	index + 1 < lines.length &&
	SEPARATOR.test(lines[index + 1]) &&
	lines[index + 1].includes("-");

function splitRow(line) {
	const cells = line.replace(/^\s*\|/, "").replace(/\|\s*$/, "").split("|");
	return cells.map((cell) => cell.trim());
}

function alignment(separator) {
	return splitRow(separator).map((cell) => {
		const left = cell.startsWith(":");
		const right = cell.endsWith(":");
		if (left && right) return "center";
		if (right) return "right";
		if (left) return "left";
		return "";
	});
}

function renderTable(lines, start) {
	const header = splitRow(lines[start]);
	const align = alignment(lines[start + 1]);
	let index = start + 2;
	const rows = [];
	while (index < lines.length && lines[index].includes("|") && lines[index].trim() !== "") {
		rows.push(splitRow(lines[index]));
		index += 1;
	}
	const style = (column) => (align[column] ? ` style="text-align:${align[column]}"` : "");
	const head = header
		.map((cell, column) => `<th${style(column)}>${inline(cell)}</th>`)
		.join("");
	const body = rows
		.map(
			(row) =>
				`<tr>${header
					.map((_, column) => `<td${style(column)}>${inline(row[column] ?? "")}</td>`)
					.join("")}</tr>`,
		)
		.join("");
	return {
		html: `<table><thead><tr>${head}</tr></thead>${body ? `<tbody>${body}</tbody>` : ""}</table>`,
		next: index,
	};
}

export function renderMarkdown(source) {
	// Escaped exactly once, here. Every later step sees escaped text, which is what
	// makes emitting it safe and what stops anything below from double-escaping.
	const text = escapeHtml(stripAnsi(source)).replace(/\r\n?/g, "\n");
	return renderBlocks(text.split("\n"));
}

function renderBlocks(lines) {
	const html = [];
	let index = 0;

	while (index < lines.length) {
		const line = lines[index];

		if (line.trim() === "") {
			index += 1;
			continue;
		}

		const fence = line.match(FENCE);
		if (fence !== null) {
			const marker = fence[1][0].repeat(3);
			const language = fence[2];
			const body = [];
			index += 1;
			while (index < lines.length && !lines[index].trim().startsWith(marker)) {
				body.push(lines[index]);
				index += 1;
			}
			index += 1;
			const label = language ? ` data-lang="${language}"` : "";
			html.push(`<pre class="code"${label}><code>${body.join("\n")}</code></pre>`);
			continue;
		}

		if (RULE.test(line) && !ITEM.test(line)) {
			html.push("<hr />");
			index += 1;
			continue;
		}

		const heading = line.match(HEADING);
		if (heading !== null) {
			const level = heading[1].length;
			html.push(`<h${level}>${inline(heading[2])}</h${level}>`);
			index += 1;
			continue;
		}

		if (isTableStart(lines, index)) {
			const table = renderTable(lines, index);
			html.push(table.html);
			index = table.next;
			continue;
		}

		if (QUOTE.test(line)) {
			const body = [];
			while (index < lines.length && QUOTE.test(lines[index])) {
				body.push(lines[index].match(QUOTE)[1]);
				index += 1;
			}
			html.push(`<blockquote>${renderBlocks(body)}</blockquote>`);
			continue;
		}

		if (ITEM.test(line)) {
			// A single list level, plus one nested level via indentation.
			const ordered = /^\d/.test(line.trim());
			const items = [];
			while (index < lines.length && ITEM.test(lines[index])) {
				const item = lines[index].match(ITEM);
				items.push({ indent: item[1].length, ordered: /^\d/.test(item[2]), text: item[3] });
				index += 1;
				// continuation lines belong to the item they follow
				while (
					index < lines.length &&
					lines[index].trim() !== "" &&
					!ITEM.test(lines[index]) &&
					/^\s{2,}/.test(lines[index]) &&
					!FENCE.test(lines[index])
				) {
					items[items.length - 1].text += `\n${lines[index].trim()}`;
					index += 1;
				}
			}
			const base = Math.min(...items.map((item) => item.indent));
			// A nested list is a child of the item above it, so opening one has to
			// close that item first and reopen it once the nested list ends.
			const stack = [ordered];
			let out = ordered ? "<ol>" : "<ul>";
			let depth = 0;
			for (const item of items) {
				const level = item.indent > base ? 1 : 0;
				while (depth > level) {
					out += `${stack.pop() ? "</ol>" : "</ul>"}</li>`;
					depth -= 1;
				}
				if (level > depth) {
					out = out.replace(/<\/li>$/, "");
					stack.push(item.ordered);
					out += item.ordered ? "<ol>" : "<ul>";
					depth = level;
				}
				out += `<li>${inline(item.text).replace(/\n/g, "<br />")}</li>`;
			}
			while (depth > 0) {
				out += `${stack.pop() ? "</ol>" : "</ul>"}</li>`;
				depth -= 1;
			}
			out += stack.pop() ? "</ol>" : "</ul>";
			html.push(out);
			continue;
		}

		// Paragraph: consecutive plain lines, line breaks preserved.
		const body = [];
		while (
			index < lines.length &&
			lines[index].trim() !== "" &&
			!FENCE.test(lines[index]) &&
			!HEADING.test(lines[index]) &&
			!QUOTE.test(lines[index]) &&
			!ITEM.test(lines[index]) &&
			!RULE.test(lines[index]) &&
			!isTableStart(lines, index)
		) {
			body.push(lines[index]);
			index += 1;
		}
		html.push(`<p>${inline(body.join("\n")).replace(/\n/g, "<br />")}</p>`);
	}

	return html.join("");
}
