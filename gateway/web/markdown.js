/**
 * Markdown rendering for assistant replies.
 *
 * marked parses, DOMPurify sanitises, highlight.js colours code. The renderer is
 * not hand-rolled any more, but the trust model is unchanged: assistant text and
 * tool output are untrusted, so the parsed HTML is always sanitised before it
 * reaches the DOM, raw HTML in the source is escaped rather than passed through,
 * and images are refused outright — a remote image in a reply is an exfiltration
 * channel, since the URL is fetched by your browser.
 *
 * Single newlines become line breaks (marked's `breaks`): the chat convention
 * rather than the CommonMark one, because models write short lines.
 */
import { Marked } from "./vendor/marked.js";
import DOMPurify from "./vendor/dompurify.js";
import hljs from "./vendor/highlight.js";

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

const marked = new Marked({
	gfm: true,
	breaks: true,
});

// Raw HTML is escaped instead of rendered, so a reply cannot inject markup that
// the sanitiser then has to be clever about.
const escapeBlock = (token) => escapeHtml(token.raw ?? token.text ?? "");
marked.use({
	renderer: {
		html: escapeBlock,
		code({ text, lang }) {
			const language = (lang ?? "").trim().split(/\s+/)[0];
			const known = language !== "" && hljs.getLanguage(language) !== undefined;
			// Highlighting escapes the code as it wraps it, so the result is safe.
			const body = known
				? hljs.highlight(text, { language, ignoreIllegals: true }).value
				: escapeHtml(text);
			const label = known ? ` class="hljs language-${escapeHtml(language)}"` : "";
			const badge = language === "" ? "" : `<span class="code-lang">${escapeHtml(language)}</span>`;
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

const PURIFY = {
	// Images are refused rather than sanitised: a remote URL in a reply makes your
	// browser fetch it, which is a way to signal information outward.
	FORBID_TAGS: ["img", "style", "form", "input", "button", "iframe", "object", "embed", "svg", "math"],
	FORBID_ATTR: ["style", "srcset", "formaction"],
	ADD_ATTR: ["target", "rel"],
	ALLOW_DATA_ATTR: false,
};

/** Markdown source in, sanitised HTML out. */
export function renderMarkdown(source) {
	const text = stripAnsi(source).replace(/\r\n?/g, "\n");
	return DOMPurify.sanitize(marked.parse(text), PURIFY);
}
