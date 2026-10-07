/** Spend and token labels, in the shape the old client already used. */
export function formatTokens(value: number): string {
	if (value < 1000) return `${Math.round(value)} tok`;
	if (value < 1_000_000) return `${(value / 1000).toFixed(1)}k tok`;
	return `${(value / 1_000_000).toFixed(1)}M tok`;
}

export function formatCost(value: number): string {
	return `$${value.toFixed(4)}`;
}
