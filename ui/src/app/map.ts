import type {
	ConversationSummary,
	ModelChoice,
	PickerGroup,
	SandboxSummary,
	TranscriptEntry,
	WorkspaceSummary,
} from "./view-models";
import type {
	WireAgentSummary,
	WireContentBlock,
	WireConversation,
	WireEntry,
	WireMessage,
	WireProvider,
	WireSandbox,
	WireScopeDefaults,
	WireSender,
	WireToolSlot,
	WireView,
	WireState,
	WireWorkspace,
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

/**
 * The reasoning the provider shared, if any. Thinking blocks ride inside the message
 * content beside the text; the transcript lifts them into their own card, ahead of the
 * reply they produced. A fully redacted block still renders — as the fact of hiding —
 * because silence about silence reads as nothing happening.
 */
function thinkingOf(
	messages: { content?: string | WireContentBlock[] | undefined }[],
): string | undefined {
	const parts: string[] = [];
	let redacted = false;
	for (const message of messages) {
		if (!Array.isArray(message.content)) continue;
		for (const block of message.content) {
			if (block.type !== "thinking") continue;
			if (typeof block.thinking === "string" && block.thinking.trim() !== "") {
				parts.push(block.thinking);
			} else if (block.redacted === true) {
				redacted = true;
			}
		}
	}
	if (parts.length > 0) return parts.join("\n");
	if (redacted) return "Hidden by safety filters.";
	return undefined;
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
		// Last activity, so the rail can group by date; absent stays flat.
		updatedAt:
			conversation.updatedAt === undefined ? undefined : new Date(conversation.updatedAt),
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
		// Only done is done: a pending call has not started yet, but its round is live,
		// so the card stays open and counts as the run happening.
		status: slot.status === "done" ? "done" : "running",
		isError: (slot.diagnostics ?? []).some((diagnostic) => diagnostic.severity === "error"),
		args: calls.get(slot.callId)?.args,
		output: slot.output ?? "",
	};
}

/** The workspaces as the rail lists them, with the one in view marked. */
export function toWorkspaces(workspaces: WireWorkspace[], activeName: string): WorkspaceSummary[] {
	return workspaces.map((workspace) => ({
		name: workspace.name,
		title: workspace.title,
		path: workspace.path,
		general: workspace.general,
		running: workspace.running,
		active: workspace.name === activeName,
		image: workspace.image,
		network: workspace.network,
	}));
}

export function toSandbox(sandbox: WireSandbox): SandboxSummary {
	return {
		engine: sandbox.engine ?? "none",
		version: sandbox.version ?? "",
		status: sandbox.status ?? "unknown",
		tools: sandbox.tools,
		isolated: sandbox.isolated,
		problem: sandbox.problem,
	};
}

/**
 * The models someone can actually call: a provider without a credential is not a choice, it
 * is a dead end, and offering it would be offering a lie.
 */
export function toModelChoices(providers: WireProvider[]): ModelChoice[] {
	return providers
		.filter((provider) => provider.authenticated)
		.flatMap((provider) =>
			provider.models.map((model) => ({
				value: `${provider.id}/${model.id}`,
				provider: provider.id,
				modelId: model.id,
				label: model.name,
				thinkingLevels: model.thinkingLevels ?? [],
			})),
		);
}

export function toModelGroups(providers: WireProvider[]): PickerGroup[] {
	return providers
		.filter((provider) => provider.authenticated && provider.models.length > 0)
		.map((provider) => ({
			label: provider.name,
			options: provider.models.map((model) => ({
				value: `${provider.id}/${model.id}`,
				label: model.name,
				detail:
					model.contextWindow === undefined
						? undefined
						: `${Math.round(model.contextWindow / 1000)}k`,
			})),
		}));
}

export function toThinkingGroups(levels: string[]): PickerGroup[] {
	return [{ options: levels.map((level) => ({ value: level, label: level })) }];
}

/**
 * Agents grouped by the layer that defined them, with their descriptions: a name alone does
 * not say what an agent is for, and the layer is how someone knows what overriding it means.
 */
export function toAgentGroups(agents: WireAgentSummary[]): PickerGroup[] {
	const byLayer = new Map<string, PickerGroup["options"]>();
	for (const agent of agents) {
		const options = byLayer.get(agent.layer) ?? [];
		options.push({
			value: agent.name,
			label: agent.name,
			description: agent.description ?? agent.source,
		});
		byLayer.set(agent.layer, options);
	}
	return [...byLayer].map(([layer, options]) => ({ label: layer, options }));
}

/**
 * The whole transcript, committed entries first and the live generation after them — the
 * same order the old client rendered, because a live tool slot is attached to a call whose
 * result has not committed yet, and streaming text has no controls until it settles.
 */
export function toTranscript(
	view: WireView | undefined,
	senders: Record<string, WireSender>,
	running = false,
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
				const thinking = thinkingOf(messages);
				if (thinking !== undefined) {
					transcript.push({
						kind: "thinking",
						id: `${id}-thinking`,
						text: thinking,
						at: at(first),
					});
				}
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
	// Whether the run left visible evidence: streaming text, a running tool, the
	// thinking itself, or an accepted draft. A run with none of those is silence, and
	// silence gets the dots — but only while the run is real, so a stuck flag cannot
	// promise forever.
	let liveContent = false;
	for (const slot of live?.tools ?? []) {
		if (settled.has(slot.callId)) continue;
		if (slot.status === "running") liveContent = true;
		transcript.push(toolEntry(slot, calls));
	}

	const streaming = live?.generation?.message;
	if (streaming !== undefined) {
		const failure = failureOf(streaming);
		const markdown = textOf(streaming.content).trim();
		const thinking =
			streaming.content === undefined || typeof streaming.content === "string"
				? undefined
				: thinkingOf([{ content: streaming.content }]);
		if (thinking !== undefined) {
			liveContent = true;
			transcript.push({
				kind: "thinking",
				id: "live-thinking",
				text: thinking,
				at: at(streaming),
				live: true,
			});
		}
		if (failure !== undefined) {
			liveContent = true;
			transcript.push({
				kind: "assistant",
				id: "live",
				markdown: "",
				at: at(streaming),
				failure,
			});
		} else if (markdown !== "") {
			liveContent = true;
			transcript.push({
				kind: "assistant",
				id: "live",
				markdown,
				at: at(streaming),
				live: true,
			});
		}
	}

	// Accepted and not committed: a steered message joins the turn that is running and a
	// follow-up waits behind it. Showing them beats a message that vanished until it lands;
	// `write` items are the harness's own drafts, not a person's words.
	for (const item of view?.docs?.["pi.inbox"]?.items ?? []) {
		if (item.mode !== "steer" && item.mode !== "followUp") continue;
		const text = textOf(item.content).trim();
		if (text === "") continue;
		liveContent = true;
		transcript.push({ kind: "pending", id: `pending-${item.id}`, text, action: item.mode });
	}

	// A run with no visible evidence yet is thinking with no output: the dots are the
	// whole pane, and the promise that something is coming.
	if (running && !liveContent) {
		transcript.push({ kind: "assistant", id: "live", markdown: "", live: true });
	}

	return transcript;
}

/**
 * Which of a conversation's pins can no longer run here. A pin outlives what it names: a
 * model can leave a provider, a provider can be disconnected, an agent definition can be
 * deleted — and the conversation stays pinned to it, because pinning is what it does. The
 * interface marks those, so a conversation that cannot run says so where the choice is made
 * rather than at the first message.
 *
 * Thinking is not here: a level the model cannot express is clamped and reported as
 * `thinkingRequested`, which is a fallback rather than a failure.
 */
export function stalePins(state: WireState): { model: boolean; agent: boolean } {
	const model = `${state.agent.provider}/${state.agent.modelId}`;
	const known = toModelChoices(state.providers ?? []).some((choice) => choice.value === model);
	const definition = state.agent.definition ?? "";
	return {
		model: model !== "" && model !== "/" && !known,
		agent: definition !== "" && !(state.agents ?? []).some((one) => one.name === definition),
	};
}

/**
 * One scope's defaults as picker values: the model as `provider/modelId`, and the two names
 * as they are. Empty means this layer says nothing, which the settings screen shows as such
 * rather than borrowing the value from the layer below.
 */
export function toScopeDefaults(defaults: WireScopeDefaults | undefined): {
	model: string;
	thinking: string;
	agent: string;
} {
	const model = defaults?.model;
	return {
		model: model === undefined ? "" : `${model.provider}/${model.modelId}`,
		thinking: defaults?.thinking ?? "",
		agent: defaults?.agent ?? "",
	};
}
