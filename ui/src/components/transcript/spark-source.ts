/**
 * A `spark` fence: numbers in a line, which is a shape — going up, going down, flat — and the two
 * values at its ends, which is the fact the shape is about.
 *
 * The whole fence has to be numbers. A sparkline drawn from a line it could not read would be a
 * shape nobody wrote, so anything else stays a code block.
 */

const TOKENS = /[\s,]+/;

/** Fewer than three points is not a shape, and more than this is a chart. */
export const FEW = 3;
export const MANY = 60;

function tokensOf(source: string): string[] {
	return source.split(TOKENS).filter((token) => token !== "");
}

export function parseSpark(source: string): number[] | undefined {
	const tokens = tokensOf(source);
	if (tokens.length < FEW || tokens.length > MANY) return undefined;
	const values = tokens.map((token) => Number(token));
	return values.every((value) => Number.isFinite(value)) ? values : undefined;
}

/** Why a fence is shown as its source rather than drawn, in the reader's words. */
export function sparkRefusal(source: string): string {
	const count = tokensOf(source).length;
	if (count < FEW) return `fewer than ${FEW} numbers`;
	if (count > MANY) return `more than ${MANY} numbers`;
	return "a value that is not a number";
}
