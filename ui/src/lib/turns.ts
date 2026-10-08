import type { TranscriptEntry } from "@/app/view-models";

/**
 * Turns: a user entry starts one, and everything until the next user entry belongs to it —
 * the tools and replies are one thought, while the next user turn is a conversation
 * boundary. Notices and pending messages ride with the turn they appear in.
 */
export function groupTurns(entries: TranscriptEntry[]): TranscriptEntry[][] {
	const turns: TranscriptEntry[][] = [];
	let current: TranscriptEntry[] = [];
	for (const entry of entries) {
		if (entry.kind === "user" && current.length > 0) {
			turns.push(current);
			current = [];
		}
		current.push(entry);
	}
	if (current.length > 0) turns.push(current);
	return turns;
}
