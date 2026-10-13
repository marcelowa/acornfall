/**
 * The gateway's HTTP shapes, as this layer consumes them.
 *
 * The Go types in `gateway/internal/control` and `internal/protocol` are the definition;
 * this is the mirror a JSON client needs, kept to the fields the interface reads — a rename
 * on the wire should fail a typecheck here rather than a render later. The boundary is
 * trusted: it is our own gateway, and every consumer of these shapes maps them to a view
 * model in `map.ts` before a component sees them.
 */

export interface WireWorkspace {
	name: string;
	path: string;
	title: string;
	general: boolean;
	image?: string | undefined;
	network?: string | undefined;
	running: boolean;
}

export interface WireConversation {
	id: string;
	title: string;
	root: boolean;
	hidden: boolean;
	running: boolean;
	lastEntryId: string;
	/** Last activity, Unix ms, from the newest entry's message timestamp. Absent
	 * while the conversation has no entries, so its row renders flat. */
	updatedAt?: number | undefined;
	tokens: number;
	cost: number;
	parent?: string | undefined;
	children?: string[] | undefined;
	model?: string | undefined;
	thinking?: string | undefined;
	createdBy?: string | undefined;
}

/** The self-update summary, as the state stream carries it. */
export interface WireUpdateSummary {
	current: string;
	latest?: string | undefined;
	available: boolean;
	failed?: string | undefined;
	restartRequired?: boolean | undefined;
}

export interface WireSandbox {
	engine?: string | undefined;
	version?: string | undefined;
	status?: string | undefined;
	tools: boolean;
	isolated: boolean;
	problem?: string | undefined;
}

export interface WireModel {
	id: string;
	name: string;
	contextWindow?: number | undefined;
	/** The levels this model supports; ["off"] means it cannot reason at all. */
	thinkingLevels?: string[] | undefined;
}

export interface WireProvider {
	id: string;
	name: string;
	authenticated: boolean;
	source?: string | undefined;
	/** How this install authenticated, when it did: key or sign-in. */
	authType?: "api_key" | "oauth" | undefined;
	/** Login methods the provider offers. Empty is ambient-only. */
	authTypes?: ("api_key" | "oauth")[] | undefined;
	models: WireModel[];
}

/** One step of a provider login, a 1:1 projection of the worker's auth frames. */
export type WireAuthEvent =
	| {
			kind: "prompt";
			promptId: string;
			promptType: "text" | "secret" | "select" | "manual_code";
			message: string;
			placeholder?: string | undefined;
			options?: { id: string; label: string; description?: string }[] | undefined;
	  }
	| {
			kind: "info";
			message: string;
			links?: { url: string; label?: string }[] | undefined;
	  }
	| { kind: "auth_url"; url: string; instructions?: string | undefined }
	| {
			kind: "device_code";
			userCode: string;
			verificationUri: string;
			intervalSeconds?: number | undefined;
			expiresInSeconds?: number | undefined;
	  }
	| { kind: "progress"; message: string }
	/** The provider resolved a prompt itself — a callback won the race — so it is no longer waiting. */
	| { kind: "prompt_cancelled"; promptId: string }
	| { kind: "done"; providerId: string }
	| { kind: "error"; message: string };

export interface WireAuthFrame {
	type: "auth";
	authId: string;
	event: WireAuthEvent;
}

/** The events a dialog renders as steps: prompts and outcomes are not notices. */
export type WireAuthNotice = Extract<
	WireAuthEvent,
	{ kind: "info" | "auth_url" | "device_code" | "progress" }
>;

export interface WireCapabilities {
	steer: boolean;
	subagents: boolean;
	sandbox: string;
}

/** What a conversation chose; empty fields are inheriting. */
export interface WireBinding {
	provider: string;
	modelId: string;
	thinkingLevel?: string | undefined;
	/** The level asked for when the model could not honour it, so the UI can say why. */
	thinkingRequested?: string | undefined;
	definition?: string | undefined;
}

export interface WireAgentSummary {
	name: string;
	description?: string | undefined;
	source: string;
	layer: string;
}

export interface WireCommands {
	commands: {
		name: string;
		description?: string | undefined;
		argumentHint?: string | undefined;
		source: string;
	}[];
}

export interface WireLayerTrace {
	layer: string;
	path: string;
	/** The layer's own contribution document, left raw on purpose. */
	contributes?: unknown;
}

export interface WireResolvedAgent {
	name: string;
	source?: string | undefined;
	model?: string | undefined;
	thinking?: string | undefined;
	layers?: WireLayerTrace[] | undefined;
}

export interface WireState {
	workspace: WireWorkspace;
	workspaces: WireWorkspace[];
	conversation?: WireConversation | undefined;
	conversations: WireConversation[];
	workerUp: boolean;
	workerError?: string | undefined;
	sandbox: WireSandbox;
	/** The self-update summary: the header dot without fetching. */
	update: WireUpdateSummary;
	capabilities: WireCapabilities;
	harness: string;
	/** The effective binding: what will actually run, resolved across the layers. */
	agent: WireBinding;
	resolved?: WireResolvedAgent | undefined;
	defaultModel: WireBinding;
	defaultThinking: string;
	defaultAgent: string;
	/** Each scope's own layer, unresolved: what the settings screen shows per tab. */
	workspaceDefaults: WireScopeDefaults;
	installDefaults: WireScopeDefaults;
	/** True when another conversation created this one: its configuration is that one's. */
	subagent: boolean;
	agents: WireAgentSummary[];
	providers: WireProvider[];
	seq: number;
}

/** One layer's own defaults. Empty means the layer says nothing, not that it agrees. */
export interface WireScopeDefaults {
	model?: WireBinding | undefined;
	thinking?: string | undefined;
	agent?: string | undefined;
}

export interface WireContentBlock {
	type: string;
	text?: string | undefined;
	thinking?: string | undefined;
	redacted?: boolean | undefined;
	id?: string | undefined;
	name?: string | undefined;
	arguments?: unknown;
}

/** A tool the model was given, as a system entry adds it. */
export interface WireTool {
	name: string;
	description?: string | undefined;
	parameters?: unknown;
}

/** What a provider reported for one call. */
export interface WireUsage {
	input: number;
	output: number;
	cacheRead?: number | undefined;
	cacheWrite?: number | undefined;
}

export interface WireMessage {
	content: string | WireContentBlock[];
	timestamp?: number | undefined;
	stopReason?: string | undefined;
	errorMessage?: string | undefined;
	provider?: string | undefined;
	model?: string | undefined;
	toolCallId?: string | undefined;
	toolName?: string | undefined;
	isError?: boolean | undefined;
	/** System entries carry the prompt as patches: `null` removes a section. */
	sections?: Record<string, string | null> | undefined;
	toolsAdded?: WireTool[] | undefined;
	toolsRemoved?: { name: string }[] | undefined;
	usage?: WireUsage | undefined;
}

export interface WireEntry {
	id: number;
	kind: string;
	model?: WireMessage[] | undefined;
	/** Display-only payload, never model context: the notice text lives here. */
	data?: { text?: string | undefined } | undefined;
}

export interface WireToolSlot {
	callId: string;
	name: string;
	output?: string | undefined;
	status?: string | undefined;
	diagnostics?: { severity?: string | undefined }[] | undefined;
}

/** A message that has been accepted but not yet committed: it steers the run or waits behind it. */
export interface WireInboxItem {
	id: string;
	/** `write` items are the harness's own drafts, not something a person sent. */
	mode: "steer" | "followUp" | "write";
	content?: string | WireContentBlock[] | undefined;
}

export interface WireLive {
	generation?: { message?: WireMessage | undefined } | undefined;
	tools?: WireToolSlot[] | undefined;
}

export interface WireView {
	entries?: WireEntry[] | undefined;
	docs?:
		| {
				"pi.live"?: WireLive | undefined;
				"pi.inbox"?: { items?: WireInboxItem[] | undefined } | undefined;
		  }
		| undefined;
}

export interface WireSender {
	kind: "ask" | "report";
	name?: string | undefined;
	conversationId: string;
}

export interface WireFrame {
	type: string;
	conversationId?: string | undefined;
	value?: WireView | undefined;
	acornfall?: { senders?: Record<string, WireSender> | undefined } | undefined;
	authId?: string | undefined;
	event?: WireAuthEvent | undefined;
}
