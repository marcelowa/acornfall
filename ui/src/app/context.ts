import type { WireEntry, WireTool, WireUsage } from "./wire";

/**
 * The context inspector's fold: what the model saw, request by request.
 *
 * The harness sends the prompt as system entries that carry *patches*, not snapshots — a
 * section, a tool added, a tool removed, or a `null` that removes a section. Folding them
 * forward is the only way to answer "why did it see that": the latest request alone cannot
 * say what changed, and the log cannot say what the model actually received.
 *
 * This is a pure function over the transcript, so it is tested without a browser: it was the
 * one piece of the old client that needed a DOM stub to be tested at all, and a DOM stub
 * proved nothing about the fold.
 */

export interface ContextChanges {
	sectionsAdded: string[];
	sectionsRemoved: string[];
	sectionsChanged: string[];
	toolsAdded: string[];
	toolsRemoved: string[];
}

export interface ContextRequest {
	entryId: number;
	/** The state at this request, copied: the fold moves forward and this must not. */
	sections: Map<string, string>;
	tools: Map<string, WireTool>;
	changes: ContextChanges;
	/** The request this one was built on, or null when it is the first. */
	previousId: number | null;
}

export function foldContext(entries: WireEntry[]): ContextRequest[] {
	const sections = new Map<string, string>();
	const tools = new Map<string, WireTool>();
	const requests: ContextRequest[] = [];

	for (const entry of entries) {
		if (entry.kind !== "pi.system") continue;
		const message = entry.model?.[0];
		const changes: ContextChanges = {
			sectionsAdded: [],
			sectionsRemoved: [],
			sectionsChanged: [],
			toolsAdded: [],
			toolsRemoved: [],
		};

		for (const [name, text] of Object.entries(message?.sections ?? {})) {
			const before = sections.get(name);
			if (text === null || text === undefined) {
				if (before !== undefined) {
					sections.delete(name);
					changes.sectionsRemoved.push(name);
				}
				continue;
			}
			if (before === undefined) changes.sectionsAdded.push(name);
			else if (before !== text) changes.sectionsChanged.push(name);
			sections.set(name, text);
		}

		for (const tool of message?.toolsAdded ?? []) {
			tools.set(tool.name, tool);
			changes.toolsAdded.push(tool.name);
		}
		for (const tool of message?.toolsRemoved ?? []) {
			if (tools.delete(tool.name)) changes.toolsRemoved.push(tool.name);
		}

		requests.push({
			entryId: entry.id,
			sections: new Map(sections),
			tools: new Map(tools),
			changes,
			previousId:
				requests.length > 0 ? (requests[requests.length - 1]?.entryId ?? null) : null,
		});
	}

	return requests;
}

/** The provider's own count for the last call, which is what a spend question is about. */
export function lastUsage(entries: WireEntry[]): WireUsage | undefined {
	for (let index = entries.length - 1; index >= 0; index -= 1) {
		const entry = entries[index];
		if (entry?.kind !== "pi.assistant") continue;
		const usage = entry.model?.[0]?.usage;
		if (usage !== undefined) return usage;
	}
	return undefined;
}

/**
 * Four characters to a token: the old client's rule, and it is enough to compare one section
 * against another. It is not a bill — the provider's own usage is.
 */
export function estimateTokens(text: string): number {
	return Math.ceil(text.length / 4);
}
