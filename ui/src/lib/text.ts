/** Terminal output arrives with colour codes; they render as noise in a browser. */
export function stripAnsi(text: string): string {
	// oxlint-disable-next-line no-control-regex -- matching escape bytes is the whole job
	return text.replace(
		/[\u001b\u009b][[()#;?]*(?:\d{1,4}(?:;\d{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
		"",
	);
}

/** Text on its way into HTML: a fence's words are the model's, and they are not markup. */
export function escapeHtml(value: string): string {
	return value.replace(/[&<>"']/g, (char) => ENTITIES[char] ?? char);
}

const ENTITIES: Record<string, string> = {
	"&": "&amp;",
	"<": "&lt;",
	">": "&gt;",
	'"': "&quot;",
	"'": "&#39;",
};
