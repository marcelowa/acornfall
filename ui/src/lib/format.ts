/** Spend and token labels, in the shape the old client already used. */
export function formatTokens(value: number): string {
	if (value < 1000) return `${Math.round(value)} tok`;
	if (value < 1_000_000) return `${(value / 1000).toFixed(1)}k tok`;
	return `${(value / 1_000_000).toFixed(1)}M tok`;
}

export function formatCost(value: number): string {
	return `$${value.toFixed(4)}`;
}

/**
 * The composer's context line from the provider's own count: exact, never
 * guessed. Without a window there is no percent, only the count.
 */
export function formatContext(used: number, window?: number | undefined): string {
	if (window === undefined) return `${formatTokens(used)} in`;
	return `${formatTokens(used)} of ${formatTokens(window)} (${Math.round((used / window) * 100)}%)`;
}
