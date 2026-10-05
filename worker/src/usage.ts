/**
 * What a conversation spent, from the counters durable keeps per conversation.
 *
 * One home because two report it: the conversation listing says what a conversation has used,
 * and the subagent listing says the same for a child it made.
 */
import type { UsageState } from "@earendil-works/pi-durable";

/** Total tokens across the models a conversation has used. */
export function totalTokens(usage: UsageState | undefined): number {
	return Object.values(usage?.models ?? {}).reduce((sum, entry) => sum + (entry.totalTokens ?? 0), 0);
}

/** Total cost across them, which the conversation listing shows beside the tokens. */
export function totalCost(usage: UsageState | undefined): number {
	return Object.values(usage?.models ?? {}).reduce((sum, entry) => sum + (entry.cost?.total ?? 0), 0);
}
