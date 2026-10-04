/**
 * Conversation metadata: the name a person gave it, and whether it is hidden.
 *
 * This lives in a durable document committed with the conversation rather than in
 * control's settings file, so there is one source of truth for it, it survives the
 * loss of our own configuration, and forks inherit it by the same rules as every
 * other document. See docs/adr/0006-conversation-lifecycle.md.
 */
import { defineDoc, type ConversationId } from "@earendil-works/pi-durable";

export type ConversationMeta = {
	/** Empty means "no name given": fall back to the first user message. */
	title: string;
	/** Hidden conversations stay in storage; they are filtered from the list. */
	hidden: boolean;
	/** The agent definition this conversation runs, so delegation can resolve it. */
	definition?: string;
	/** Conversations this one created, so a subagent list needs no scan. */
	children?: string[];
	/**
	 * The conversation that created this one, when something other than the user did.
	 * A peer is ownerless, so this is the only trace of where it came from.
	 */
	createdBy?: string;
};

export const ConversationMetaDoc = defineDoc<ConversationMeta>({
	kind: "acornfall.meta",
	version: 1,
	scope: "conversation",
	history: "latest",
	fork: "initial",
	initial: () => ({ title: "", hidden: false, children: [] }),
});

export function conversationIdOf(id: string): ConversationId {
	const numeric = Number(id);
	if (!Number.isInteger(numeric) || numeric <= 0) throw new Error(`invalid conversation id ${id}`);
	return numeric as ConversationId;
}
