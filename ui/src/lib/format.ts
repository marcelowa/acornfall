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
 * When a conversation last moved, in the few characters a rail row has: `now`, `12m`, `3h`,
 * `2d`, `1w`. It exists because the rail shows the value on the row now — a tooltip has no
 * equivalent on a phone — and because a running dot on its own cannot say whether a run is
 * working or stuck.
 */
export function formatMoved(at: Date | undefined, now: Date = new Date()): string {
	if (at === undefined) return "";
	const minutes = Math.max(0, Math.floor((now.getTime() - at.getTime()) / 60_000));
	if (minutes < 1) return "now";
	if (minutes < 60) return `${minutes}m`;
	const hours = Math.floor(minutes / 60);
	if (hours < 24) return `${hours}h`;
	const days = Math.floor(hours / 24);
	return days < 7 ? `${days}d` : `${Math.floor(days / 7)}w`;
}

/**
 * The composer's context line from the provider's own count: exact, never
 * guessed. Without a window there is no percent, only the count.
 */
export function formatContext(used: number, window?: number | undefined): string {
	if (window === undefined) return `${formatTokens(used)} in`;
	return `${formatTokens(used)} of ${formatTokens(window)} (${Math.round((used / window) * 100)}%)`;
}
