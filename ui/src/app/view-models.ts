/**
 * The shapes the screens render.
 *
 * The app layer maps the platform's protocol — state frames, entries, sandbox state — onto
 * these. A screen or a component never sees a wire type, a frame, or a fetch: it is handed a
 * view model and reports a callback. That is the boundary that makes every state renderable
 * in Storybook with a literal.
 */

/** One selectable workspace: where it points, what runs it, and whether it is the one in view. */
export interface WorkspaceSummary {
	name: string;
	title: string;
	path: string;
	general: boolean;
	/** The worker process for this workspace is up. */
	running: boolean;
	active: boolean;
	image?: string | undefined;
	network?: string | undefined;
}

/** What the agent's tools can reach, as the interface has to be able to say. */
export interface SandboxSummary {
	engine: string;
	version: string;
	status: string;
	/** False means the tools refuse rather than running on the host. */
	tools: boolean;
	/** False is the host engine: no isolation, and the interface has to say so. */
	isolated: boolean;
	problem?: string | undefined;
}

/** One conversation as the rail needs it. */
export interface ConversationSummary {
	id: string;
	title: string;
	/** The conversation the workspace started with. Identity is text, not a second dot. */
	root: boolean;
	/** Tombstoned, not deleted: the rail tucks it under "Deleted" and offers restore. */
	hidden: boolean;
	/** A run is underway right now. */
	running: boolean;
	/** Entries arrived since this conversation was last looked at. Derived by the app. */
	unread: boolean;
	/** Set when another conversation created this one: a subagent, which belongs to its parent. */
	parent?: string | undefined;
	/** Set when another conversation an agent created owns itself: a peer. */
	createdBy?: string | undefined;
	model?: string | undefined;
	thinking?: string | undefined;
	tokens: number;
	cost: number;
}

/** A message another conversation sent, which arrives as a user entry and must not be read as yours. */
export interface AgentSender {
	kind: "ask" | "report";
	name?: string | undefined;
	conversationId: string;
}

export type TranscriptEntry = UserEntry | AssistantEntry | ToolEntry | NoticeEntry | PendingEntry;

export interface UserEntry {
	kind: "user";
	id: string;
	text: string;
	at?: Date | undefined;
	/** Set when another conversation's words arrived here. */
	sender?: AgentSender | undefined;
	/** Set when this message can be branched from. */
	forkAt?: string | undefined;
}

export interface AssistantEntry {
	kind: "assistant";
	id: string;
	markdown: string;
	at?: Date | undefined;
	/** A provider failure: the entry has no content and this is the only explanation there is. */
	failure?: string | undefined;
	/** Still being written: render the text, but no controls until it settles. */
	live?: boolean | undefined;
}

export interface ToolEntry {
	kind: "tool";
	id: string;
	name: string;
	status: "running" | "done";
	isError: boolean;
	args?: unknown;
	output: string;
	at?: Date | undefined;
}

export interface NoticeEntry {
	kind: "notice";
	id: string;
	text: string;
	at?: Date | undefined;
}

/**
 * Something sent while a turn was running. It is real — the server took it — but it has not
 * committed yet, so the transcript says so instead of pretending it is not there.
 */
export interface PendingEntry {
	kind: "pending";
	id: string;
	text: string;
	action: "steer" | "followUp";
}

/** One choice in a picker: the value is what the wire takes, the label is what a person reads. */
export interface PickerOption {
	value: string;
	label: string;
	detail?: string | undefined;
	/** A sentence under the label, for choices whose name is not the whole story. */
	description?: string | undefined;
}

export interface PickerGroup {
	label?: string | undefined;
	options: PickerOption[];
}

/** One picker's whole state: the value, where it came from, and what choosing does. */
export interface ChoicePicker {
	value: string;
	origin?: string | undefined;
	note?: string | undefined;
	groups: PickerGroup[];
	disabled?: boolean | undefined;
	onSelect: (value: string) => void;
}

/** A slash command the server would expand; the interface only offers the list. */
export interface SlashCommand {
	name: string;
	description?: string | undefined;
	argumentHint?: string | undefined;
	source: string;
}

/** How a turn is sent while one is already running. */
export type BusyAction = "steer" | "followUp";

/** One selectable model, flattened from the providers that are actually authenticated. */
export interface ModelChoice {
	/** `provider/modelId`, the value the binding takes. */
	value: string;
	provider: string;
	modelId: string;
	label: string;
	/** The levels this model supports; the picker never offers one that is a lie. */
	thinkingLevels: string[];
}
