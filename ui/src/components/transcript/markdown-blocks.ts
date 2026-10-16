/**
 * A reply split at the fences the console draws itself.
 *
 * The transcript parses markdown into one HTML string, and a drawing cannot be a string: Mermaid
 * has to load, run, and be inserted as a node, and a chart is a component. Splitting the source
 * before the parse is the smallest way to have both — the prose still goes through `marked`
 * unchanged, and each block arrives as its own component.
 *
 * A fence that is still open is not a block yet, it is what the reply is writing, so it stays
 * text. That is what makes a streaming reply show "```mermaid" until it closes instead of starting
 * a render on half a diagram.
 */

export type DrawnKind = "mermaid" | "chart";

export type MarkdownSegment =
	| { kind: "text"; text: string }
	| { kind: "mermaid"; source: string }
	| { kind: "chart"; source: string };

/** The languages the console draws, and nothing else. A plain info string only: `mermaid` with
 * options belongs to that diagram type, and `chart` with a title on it is a title the drawing has
 * no place for, so both stay code blocks rather than a guess. */
const DRAWN: Record<string, DrawnKind> = { mermaid: "mermaid", chart: "chart" };

/** An opening fence: up to three spaces, three or more backticks or tildes, then the info string. */
const OPENING = /^ {0,3}(`{3,}|~{3,})[ \t]*([^\n]*)$/;

/** A closing fence: the same character as the opener, at least as long, and nothing after it. */
const CLOSING = /^ {0,3}(`{3,}|~{3,})[ \t]*$/;

/** A directive line: `%%{init: {"theme": "dark"}}%%`. Mermaid reads configuration from these, and
 * the console configures Mermaid itself from its own tokens, so they are dropped rather than
 * handed over. */
const DIRECTIVE = /^[ \t]*%%\{.*\}%%[ \t]*$/;

/** A line with where it starts in the source, so a segment is a slice of the reply rather than a
 * re-join that loses the newlines around a diagram. */
interface Line {
	text: string;
	start: number;
}

function linesOf(source: string): Line[] {
	const lines: Line[] = [];
	let start = 0;
	for (const text of source.split("\n")) {
		lines.push({ text, start });
		start += text.length + 1;
	}
	return lines;
}

/** The index of the line that closes the fence opened with `fence`, or -1 when the reply has not
 * written one yet. A block opened with four backticks can hold a three-backtick line, so the run
 * has to be at least as long as the one that opened it. */
function closingLine(lines: readonly Line[], from: number, fence: string): number {
	const char = fence.charAt(0);
	for (let index = from; index < lines.length; index += 1) {
		const run = CLOSING.exec(lines[index]?.text ?? "")?.[1];
		if (run === undefined || run.charAt(0) !== char || run.length < fence.length) continue;
		return index;
	}
	return -1;
}

export function splitBlocks(source: string): MarkdownSegment[] {
	const lines = linesOf(source);
	const segments: MarkdownSegment[] = [];
	/** The first line of the text run being collected; -1 when there is none. */
	let first = -1;
	let index = 0;

	const flush = (until: number) => {
		if (first < 0) return;
		segments.push({ kind: "text", text: source.slice(lines[first]?.start ?? 0, until) });
		first = -1;
	};

	while (index < lines.length) {
		const line = lines[index];
		if (line === undefined) break;
		const opening = OPENING.exec(line.text);
		const fence = opening?.[1];
		if (fence === undefined) {
			if (first < 0) first = index;
			index += 1;
			continue;
		}

		const end = closingLine(lines, index + 1, fence);
		if (end === -1) {
			// The model is still writing it. Everything left is text, and the next delta gets
			// another look at the whole reply.
			if (first < 0) first = index;
			index = lines.length;
			break;
		}

		const kind = DRAWN[(opening?.[2] ?? "").trim().toLowerCase()];
		if (kind !== undefined) {
			flush(line.start);
			const body = lines
				.slice(index + 1, end)
				.map((body) => body.text)
				// A Mermaid directive configures Mermaid, and the console configures Mermaid from its
				// own tokens; a chart has no directives at all.
				.filter((line) => kind !== "mermaid" || !DIRECTIVE.test(line));
			segments.push({ kind, source: body.join("\n") });
		} else if (first < 0) {
			// Another language's block, held as text in one piece: a `mermaid` line inside it is
			// that block's content, not a diagram.
			first = index;
		}
		index = end + 1;
	}

	flush(source.length);
	return segments;
}
