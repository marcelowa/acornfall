/** Terminal output arrives with colour codes; they render as noise in a browser. */
export function stripAnsi(text: string): string {
	// oxlint-disable-next-line no-control-regex -- matching escape bytes is the whole job
	return text.replace(
		/[\u001b\u009b][[()#;?]*(?:\d{1,4}(?:;\d{0,4})*)?[0-9A-ORZcf-nqry=><]/g,
		"",
	);
}
