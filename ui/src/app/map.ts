import type { ConversationSummary, TranscriptEntry } from "./view-models";
import type {
	WireContentBlock,
	WireConversation,
	WireEntry,
	WireMessage,
	WireSender,
	WireToolSlot,
	WireView,
} from "./wire";

/** Everything a message says, whichever shape its content is in. */
export function textOf(content: string | WireContentBlock[] | undefined): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter((block) => block.type === "text")
		.map((block) => block.text ?? "")
		.join("");
}

/**
 * A provider failure is a committed assistant message with no content and a stop reason of
 * error or aborted. It has to become the pane: rendering nothing would hide the only
 * explanation there is.
 */
export function failureOf(message: WireMessage | undefined): string | undefined {
	if (message === undefined) return undefined;
	if (message.stopReason !== "error" && message.stopReason !== "aborted") return undefined;
	const detail =
		message.errorMessage ??
		(message.stopReason === "aborted" ? "aborted" : "the model call failed");
	return `${message.provider ?? "provider"}/${message.model ?? "model"}: ${detail}`;
}

/** Tool results name the call they answer; the call's arguments and name live on the assistant message. */
function toolCalls(
	entries: WireEntry[],
): Map<string, { name?: string | undefined; args?: unknown }> {
	const calls = new Map<string, { name?: string | undefined; args?: unknown }>();
	for (const entry of entries) {
		for (const message of entry.model ?? []) {
			if (!Array.isArray(message.content)) continue;
			for (const block of message.content) {
				if (block.type !== "toolCall" || block.id === undefined) continue;
				calls.set(block.id, { name: block.name, args: block.arguments });
			}
		}
	}
	return calls;
}

function at(message: WireMessage | undefined): Date | undefined {
	if (message?.timestamp === undefined) return undefined;
	return new Date(message.timestamp);
}

export function toConversation(
	conversation: WireConversation,
	activeId: string | undefined,
	seen: string | undefined,
): ConversationSummary {
	return {
		id: conversation.id,
		title: conversation.title,
		root: conversation.root,
		hidden: conversation.hidden,
		running: conversation.running,
		// Reading a conversation marks it read; anything else that moved is unread.
		unread:
			!conversation.hidden &&
			conversation.id !== activeId &&
			seen !== conversation.lastEntryId,
		parent: conversation.parent,
		createdBy: conversation.createdBy,
		model: conversation.model,
		thinking: conversation.thinking,
		tokens: conversation.tokens,
		cost: conversation.cost,
	};
}

function toolEntry(
	slot: WireToolSlot,
	calls: Map<string, { name?: string | undefined; args?: unknown }>,
): TranscriptEntry {
	return {
		kind: "tool",
		id: `live-${slot.callId}`,
		name: slot.name,
		status: slot.status === "running" ? "running" : "done",
		isError: (slot.diagnostics ?? []).some((diagnostic) => diagnostic.severity === "error"),
		args: calls.get(slot.callId)?.args,
		output: slot.output ?? "",
	};
}

/**
 * The whole transcript, committed entries first and the live generation after them — the
 * same order the old client rendered, because a live tool slot is attached to a call whose
 * result has not committed yet, and streaming text has no controls until it settles.
 */
export function toTranscript(
	view: WireView | undefined,
	senders: Record<string, WireSender>,
): TranscriptEntry[] {
	const entries = view?.entries ?? [];
	const calls = toolCalls(entries);
	const transcript: TranscriptEntry[] = [];

	for (let index = 0; index < entries.length; index += 1) {
		const entry = entries[index];
		if (entry === undefined) continue;
		const messages = entry.model ?? [];
		const first = messages[0];
		const id = String(entry.id);

		switch (entry.kind) {
			case "pi.user": {
				const text = messages
					.map((message) => textOf(message.content))
					.join("\n")
					.trim();
				if (text === "") break;
				// A branch keeps everything before the message, so it forks at the entry that
				// precedes a user turn, not at the turn itself.
				const previous = index > 0 ? entries[index - 1] : undefined;
				transcript.push({
					kind: "user",
					id,
					text,
					at: at(first),
					sender: senders[id],
					forkAt: previous === undefined ? undefined : String(previous.id),
				});
				break;
			}
			case "pi.assistant": {
				const failure = failureOf(first);
				const markdown = messages
					.map((message) => textOf(message.content))
					.join("\n")
					.trim();
				if (failure === undefined && markdown === "") break;
				transcript.push({ kind: "assistant", id, markdown, at: at(first), failure });
				break;
			}
			case "pi.tool-result": {
				const call =
					first?.toolCallId === undefined ? undefined : calls.get(first.toolCallId);
				transcript.push({
					kind: "tool",
					id,
					name: first?.toolName ?? call?.name ?? "tool",
					status: "done",
					isError: first?.isError === true,
					args: call?.args,
					output: textOf(first?.content),
					at: at(first),
				});
				break;
			}
			case "pi.compaction":
			case "pi.reset": {
				transcript.push({
					kind: "notice",
					id,
					text: entry.kind === "pi.compaction" ? "context compacted" : "context reset",
					at: at(first),
				});
				break;
			}
			default:
				break;
		}
	}

	const live = view?.docs?.["pi.live"];
	const settled = new Set(
		entries
			.filter((entry) => entry.kind === "pi.tool-result")
			.map((entry) => entry.model?.[0]?.toolCallId)
			.filter((callId) => callId !== undefined),
	);
	for (const slot of live?.tools ?? []) {
		if (settled.has(slot.callId)) continue;
		transcript.push(toolEntry(slot, calls));
	}

	const streaming = live?.generation?.message;
	if (streaming !== undefined) {
		const failure = failureOf(streaming);
		const markdown = textOf(streaming.content).trim();
		if (failure !== undefined) {
			transcript.push({
				kind: "assistant",
				id: "live",
				markdown: "",
				at: at(streaming),
				failure,
			});
		} else if (markdown !== "") {
			transcript.push({
				kind: "assistant",
				id: "live",
				markdown,
				at: at(streaming),
				live: true,
			});
		}
	}

	return transcript;
}
