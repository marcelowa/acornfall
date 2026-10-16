import DOMPurify, { type Config } from "dompurify";
import hljs from "highlight.js/lib/common";
import { Lexer, Marked, type Token } from "marked";
import { stripAnsi } from "@/lib/text";

/**
 * The markdown renderer, separate from the component so it can be tested without a bundler:
 * marked parses, DOMPurify sanitises, highlight.js colours. Assistant text and tool output
 * are untrusted — raw HTML in the source is escaped rather than passed through, images are
 * refused (a remote image is an exfiltration channel, because your browser fetches it for the
 * author), and every link is opened hardened.
 *
 * Single newlines become line breaks: the chat convention, because models write short lines.
 */
const marked = new Marked({ gfm: true, breaks: true });

const ENTITIES: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#39;",
};

function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (char) => ENTITIES[char] ?? char);
}

/** GitHub's alert syntax: a quote whose first line is one of these markers. */
const ALERT_MARKER = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]$/i;

/** A plan's state, one step per line: `doing: build it`. */
const STEP = /^(done|doing|blocked|todo):[ \t]*(.*)$/i;

/**
 * A quote that opens with an alert marker, as the marker's kind and title and the tokens that
 * follow it. The marker is a paragraph of its own, which is GitHub's rule; the paragraph it
 * opened stays only when it still has words after the marker, so the reader never sees the
 * marker itself.
 */
function alert(
	tokens: readonly Token[],
): { kind: string; title: string; body: Token[] } | undefined {
	const [first, ...rest] = tokens;
	if (first?.type !== "paragraph") return undefined;
	const [marker, ...inline] = first.tokens ?? [];
	const kind =
		marker?.type === "text" ? ALERT_MARKER.exec(marker.text)?.[1]?.toLowerCase() : undefined;
	if (kind === undefined) return undefined;
	// The line break after the marker is its own token, and it has nothing left to break.
	const body = inline[0]?.type === "br" ? inline.slice(1) : inline;
	return {
		kind,
		title: kind.charAt(0).toUpperCase() + kind.slice(1),
		body: body.length === 0 ? rest : [{ ...first, tokens: body }, ...rest],
	};
}

/**
 * A plan, as the state of each of its steps: `<div class="steps">` with a dot and a line per
 * step. A line that does not name a state is a step that has not started, and it keeps its own
 * words — the console does not guess what the model meant. Undefined when the fence is empty:
 * there is nothing to draw, so the caller leaves it a code block.
 */
function steps(source: string, inline: (text: string) => string): string | undefined {
	const lines = source
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "");
	if (lines.length === 0) return undefined;
	const rows = lines.map((line) => {
		const match = STEP.exec(line);
		const kind = match?.[1]?.toLowerCase() ?? "todo";
		const body = match?.[2] ?? line;
		return `<span class="step step-${kind}"><span class="step-dot" aria-hidden="true"></span>${inline(body)}</span>`;
	});
	return `<div class="steps">${rows.join("")}</div>`;
}

marked.use({
	renderer: {
		// Raw HTML is escaped instead of rendered, so a reply cannot inject markup that the
		// sanitiser then has to be clever about.
		html(token) {
			return escapeHtml(token.raw);
		},
		// A quote with an alert marker is a callout: the one mark the console gives a warning,
		// a limit, or a tip, without a single word of prose around it.
		blockquote({ tokens }) {
			const found = alert(tokens);
			if (found === undefined)
				return `<blockquote>\n${this.parser.parse(tokens)}</blockquote>\n`;
			return `<div class="callout callout-${found.kind}"><span class="callout-label">${found.title}</span>\n${this.parser.parse(found.body)}</div>\n`;
		},
		// A task list is a plan, and a plan is read by its count. Every item has to be a task;
		// a mixed list is a list, and its boxes stay inline in it.
		list(token) {
			const items = token.items.map((item) => this.listitem(item)).join("");
			const type = token.ordered ? "ol" : "ul";
			const start =
				token.ordered && token.start !== 1 && token.start !== ""
					? ` start="${String(token.start)}"`
					: "";
			const html = `<${type}${start}>\n${items}</${type}>\n`;
			if (token.items.length < 2 || token.items.some((item) => !item.task)) return html;
			const done = token.items.filter((item) => item.checked === true).length;
			return `<div class="task-list"><span class="task-count">${done}/${token.items.length}</span>${html}</div>`;
		},
		// DOMPurify refuses `input`, so the box the checklist is read by is a span. It is an
		// icon with a label rather than a control: nothing here is clickable.
		checkbox({ checked }) {
			const done = checked === true;
			return `<span class="task-box${done ? " is-done" : ""}" role="img" aria-label="${done ? "Done" : "Not done"}">✓</span> `;
		},
		code(token) {
			const language = (token.lang ?? "").trim().split(/\s+/)[0] ?? "";
			if (language.toLowerCase() === "steps") {
				const drawn = steps(token.text, (line) =>
					this.parser.parseInline(Lexer.lexInline(line, this.parser.options)),
				);
				if (drawn !== undefined) return drawn;
			}
			const known = language !== "" && hljs.getLanguage(language) !== undefined;
			// Highlighting escapes the code as it wraps it, so the result is safe.
			const body = known
				? hljs.highlight(token.text, { language, ignoreIllegals: true }).value
				: escapeHtml(token.text);
			const label = known ? ` class="hljs language-${escapeHtml(language)}"` : "";
			const badge =
				language === "" ? "" : `<span class="code-lang">${escapeHtml(language)}</span>`;
			return `<div class="code-block">${badge}<pre><code${label}>${body}</code></pre></div>`;
		},
	},
});

DOMPurify.addHook("afterSanitizeAttributes", (node) => {
	if (node.tagName === "A") {
		node.setAttribute("target", "_blank");
		node.setAttribute("rel", "noreferrer noopener");
	}
});

const PURIFY: Config = {
	// Images are refused rather than sanitised: a remote URL in a reply makes your browser
	// fetch it, which is a way to signal information outward.
	FORBID_TAGS: [
		"img",
		"style",
		"form",
		"input",
		"button",
		"iframe",
		"object",
		"embed",
		"svg",
		"math",
	],
	FORBID_ATTR: ["style", "srcset", "formaction"],
	ADD_ATTR: ["target", "rel"],
	ALLOW_DATA_ATTR: false,
};

/** Markdown source in, sanitised HTML out. */
export function renderMarkdown(source: string): string {
	const text = stripAnsi(source).replace(/\r\n?/g, "\n");
	const parsed = marked.parse(text);
	return DOMPurify.sanitize(typeof parsed === "string" ? parsed : "", PURIFY);
}
