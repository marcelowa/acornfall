import DOMPurify, { type Config } from "dompurify";
import hljs from "highlight.js/lib/common";
import { Marked } from "marked";
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

marked.use({
	renderer: {
		// Raw HTML is escaped instead of rendered, so a reply cannot inject markup that the
		// sanitiser then has to be clever about.
		html(token) {
			return escapeHtml(token.raw);
		},
		code(token) {
			const language = (token.lang ?? "").trim().split(/\s+/)[0] ?? "";
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
