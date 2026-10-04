/**
 * Worker wire protocol. See docs/adr/0002-layers-and-protocol.md.
 *
 * JSONL on stdin/stdout, one object per line, LF-framed. stderr is diagnostics.
 */

export type WhenBusy = "steer" | "followUp" | "reject";

export interface ModelBinding {
	provider: string;
	modelId: string;
	thinkingLevel?: string;
	instructions?: string;
}

export type Command =
	| { id: string; type: "describe" }
	| { id: string; type: "open"; conversationId?: string; agent: ModelBinding }
	| { id: string; type: "attach"; conversationId: string }
	| { id: string; type: "detach"; conversationId: string }
	| { id: string; type: "prompt"; conversationId: string; text: string; whenBusy?: WhenBusy }
	| { id: string; type: "abort"; conversationId: string }
	| { id: string; type: "login"; authId: string; providerId: string; authType: "api_key" | "oauth" }
	| { id: string; type: "logout"; providerId: string }
	| { id: string; type: "auth_answer"; authId: string; promptId: string; value?: string; cancelled?: boolean }
	| { id: string; type: "auth_cancel"; authId: string }
	| { id: string; type: "usage" }
	| { id: string; type: "shutdown" };

export interface ProviderModelInfo {
	id: string;
	name: string;
	contextWindow?: number;
}

export interface ProviderInfo {
	id: string;
	name: string;
	authenticated: boolean;
	source?: string;
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
	| { kind: "device_code"; userCode: string; verificationUri: string; intervalSeconds?: number; expiresInSeconds?: number }
	| { kind: "progress"; message: string }
	| { kind: "done"; providerId: string }
	| { kind: "error"; message: string };

export type Frame =
	| { type: "response"; id: string; ok: true; data?: unknown }
	| { type: "response"; id: string; ok: false; error: string }
	| { type: "view"; conversationId: string; seq: number; value: unknown }
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
