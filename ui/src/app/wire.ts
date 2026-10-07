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
	tokens: number;
	cost: number;
	parent?: string | undefined;
	children?: string[] | undefined;
	model?: string | undefined;
	thinking?: string | undefined;
	createdBy?: string | undefined;
}

export interface WireSandbox {
	engine?: string | undefined;
	version?: string | undefined;
	status?: string | undefined;
	tools: boolean;
	isolated: boolean;
	problem?: string | undefined;
}

export interface WireState {
	workspace: WireWorkspace;
	workspaces: WireWorkspace[];
	conversation?: WireConversation | undefined;
	conversations: WireConversation[];
	workerUp: boolean;
	workerError?: string | undefined;
	sandbox: WireSandbox;
	seq: number;
}

export interface WireContentBlock {
	type: string;
	text?: string | undefined;
	id?: string | undefined;
	name?: string | undefined;
	arguments?: unknown;
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
}

export interface WireEntry {
	id: number;
	kind: string;
	model?: WireMessage[] | undefined;
}

export interface WireToolSlot {
	callId: string;
	name: string;
	output?: string | undefined;
	status?: string | undefined;
	diagnostics?: { severity?: string | undefined }[] | undefined;
}

export interface WireLive {
	generation?: { message?: WireMessage | undefined } | undefined;
	tools?: WireToolSlot[] | undefined;
}

export interface WireView {
	entries?: WireEntry[] | undefined;
	docs?: { "pi.live"?: WireLive | undefined } | undefined;
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
}
