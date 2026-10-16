/**
 * A `chart` fence: one `name: number` per line, in the order the model wrote them.
 *
 * The whole fence has to parse. A chart that quietly drops a line is a chart that lies, and the
 * source shown as a code block is the honest answer to a fence the console cannot read. A fence
 * with more lines than `MAX_POINTS` is a table, not a chart, and a table belongs in markdown.
 */

export interface ChartPoint {
	label: string;
	value: number;
}

/** Past this many bars the drawing stops being a comparison and starts being a wall. */
export const MAX_POINTS = 24;

/** A count: no sign, no unit, no thousands separator. Anything else is not a bar. */
const POINT = /^(.*?):[ \t]*([0-9]+(?:\.[0-9]+)?)[ \t]*$/;

export function parseChart(source: string): ChartPoint[] | undefined {
	const lines = source
		.split("\n")
		.map((line) => line.trim())
		.filter((line) => line !== "");
	if (lines.length === 0 || lines.length > MAX_POINTS) return undefined;
	const points: ChartPoint[] = [];
	for (const line of lines) {
		const match = POINT.exec(line);
		if (match === null) return undefined;
		points.push({ label: (match[1] ?? "").trim(), value: Number(match[2]) });
	}
	return points;
}

/** Why a fence is shown as its source rather than drawn, in the reader's words. */
export function chartRefusal(source: string): string {
	const lines = source.split("\n").filter((line) => line.trim() !== "").length;
	if (lines > MAX_POINTS) return `more than ${MAX_POINTS} bars`;
	if (lines === 0) return "no bars in it";
	return "a line that is not `name: number`";
}
