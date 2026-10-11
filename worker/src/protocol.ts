/**
 * Worker wire protocol. See docs/adr/0002-layers-and-protocol.md.
 *
 * JSONL on stdin/stdout, one object per line, LF-framed. stderr is diagnostics.
 *
 * A conversation id on the wire is the harness's own id, stringified, and is
 * opaque to control: this layer never invents one.
 */

export type WhenBusy = "steer" | "followUp" | "reject";

export interface ModelBinding {
	provider: string;
	modelId: string;
	thinkingLevel?: string;
	instructions?: string;
	/** Agent definition name; empty or absent selects the layered defaults only. */
	definition?: string;
}

export type Command =
	| { id: string; type: "describe" }
	| { id: string; type: "conversations" }
	| { id: string; type: "create" }
	| { id: string; type: "rename"; conversationId: string; title: string }
	| { id: string; type: "hide"; conversationId: string; hidden: boolean }
	| { id: string; type: "fork"; conversationId: string; at: string }
	| { id: string; type: "compact"; conversationId: string }
	| { id: string; type: "compact_preview"; conversationId: string }
	| { id: string; type: "reset"; conversationId: string }
	| {
			id: string;
			type: "action";
			conversationId: string;
			text: string;
			action: "compact" | "reset";
	  }
	| { id: string; type: "open"; conversationId: string; agent: ModelBinding }
	| { id: string; type: "attach"; conversationId: string }
	| { id: string; type: "detach"; conversationId: string }
	| { id: string; type: "prompt"; conversationId: string; text: string; whenBusy?: WhenBusy }
	| { id: string; type: "abort"; conversationId: string }
	| { id: string; type: "agents" }
	| { id: string; type: "commands" }
	| { id: string; type: "expand"; text: string }
	| { id: string; type: "policy"; conversationId: string }
	| { id: string; type: "messages"; conversationId: string }
	| { id: string; type: "reload" }
	| {
			id: string;
			type: "login";
			authId: string;
			providerId: string;
			authType: "api_key" | "oauth";
	  }
	| { id: string; type: "logout"; providerId: string }
	| {
			id: string;
			type: "auth_answer";
			authId: string;
			promptId: string;
			value?: string;
			cancelled?: boolean;
	  }
	| { id: string; type: "auth_cancel"; authId: string }
	| { id: string; type: "usage" }
	| { id: string; type: "shutdown" };

export interface ProviderModelInfo {
	id: string;
	name: string;
	contextWindow?: number;
	/** Thinking levels this model actually supports; ["off"] means it cannot reason. */
	thinkingLevels: string[];
}

export interface ProviderInfo {
	id: string;
	name: string;
	authenticated: boolean;
	source?: string;
	/** How this install is authenticated, when it is: key or sign-in. */
	authType?: "api_key" | "oauth";
	/** Login methods the provider offers here. Empty means ambient-only:
	 * the key comes from the environment or a file, and there is nothing to type. */
	authTypes: ("api_key" | "oauth")[];
	models: ProviderModelInfo[];
}

export interface DescribeData {
	provider: string;
	workdir: string;
	providers: ProviderInfo[];
	capabilities: {
		steer: boolean;
		subagents: boolean;
		sandbox: string;
	};
}

/** One conversation as the UI lists it. The id is the harness's own, stringified. */
export interface ConversationInfo {
	id: string;
	/** The given name, or the first user message truncated; "New conversation" before either. */
	title: string;
	/** True for the root conversation, which exists in every install. */
	root: boolean;
	/** Hidden conversations are listed so they can be restored, never dropped. */
	hidden: boolean;
	/** True while a run is live. Read from committed state, so it survives a restart. */
	running: boolean;
	/** Newest committed entry: the client's unread cursor. */
	lastEntryId: string;
	/** Last activity, Unix ms: the newest entry's message timestamp. Absent while
	 * the conversation has no entries, so a fresh one renders flat until it moves. */
	updatedAt?: number;
	/** Committed spend, so a background run is never invisible in cost. */
	tokens: number;
	cost: number;
	/** Set when this conversation was created by another one. */
	parent?: string;
	/** Conversations this one created, for the subagent list. */
	children?: string[];
	/** The agent this conversation actually runs, from its committed configuration. */
	model?: string;
	thinking?: string;
	/** Set when a conversation created this one without owning it: a peer. */
	createdBy?: string;
}

/** Provider auth prompts, a 1:1 projection of pi-ai's AuthPrompt and AuthEvent. */
export type AuthEvent =
	| {
			kind: "prompt";
			promptId: string;
			promptType: "text" | "secret" | "select" | "manual_code";
			message: string;
			placeholder?: string;
			options?: readonly { id: string; label: string; description?: string }[];
	  }
	| { kind: "info"; message: string; links?: readonly { url: string; label?: string }[] }
	| { kind: "auth_url"; url: string; instructions?: string }
	| {
			kind: "device_code";
			userCode: string;
			verificationUri: string;
			intervalSeconds?: number;
			expiresInSeconds?: number;
	  }
	| { kind: "progress"; message: string }
	| { kind: "done"; providerId: string }
	| { kind: "error"; message: string };

export type Frame =
	| { type: "response"; id: string; ok: true; data?: unknown }
	| { type: "response"; id: string; ok: false; error: string }
	| {
			type: "view";
			conversationId: string;
			seq: number;
			value: unknown;
			/** Our own annotation: the view mounts only durable's documents. */
			acornfall?: {
				senders: Record<string, { conversationId: string; name?: string; kind: string }>;
			};
	  }
	| { type: "submission"; conversationId: string; submissionId: string; status: string }
	| { type: "auth"; authId: string; event: AuthEvent };

/** One line of JSON on stdout. A single write keeps frames from interleaving. */
export function emit(frame: Frame): void {
	process.stdout.write(`${JSON.stringify(frame)}\n`);
}

export function log(...parts: unknown[]): void {
	process.stderr.write(`${parts.map(String).join(" ")}\n`);
}

/** Serializes command handling so a long command cannot reorder the stream. */
export class CommandQueue {
	#tail: Promise<unknown> = Promise.resolve();

	push(task: () => Promise<void>): void {
		this.#tail = this.#tail.then(task, task);
	}
}
