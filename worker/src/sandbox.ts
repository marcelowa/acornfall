import type { Files } from "./files.ts";

/**
 * A workspace's sandbox, as the worker sees it: the only way it touches the workspace.
 *
 * The worker runs on the host, next to the provider credential, and has no host path to the
 * workspace at all. Everything the model asks for — a command, a file — goes through here
 * and happens inside the sandbox, where the workspace is the only host folder mounted and
 * the machine holds nothing else of ours. See docs/adr/0012-sandbox.md.
 *
 * This file is the contract, and it names no engine. An engine is one module implementing
 * `SandboxClient` plus a way to open one — `microsandbox.ts` and `host.ts` today, which are
 * also where the engine-specific code lives. Control picks the engine and passes its name to
 * the worker, so both sides of one install use the same one; a second engine is a second file
 * here and a second `Driver` in gateway/internal/sandbox.
 */
export interface SandboxClient extends Files {
	/** The engine's name for this sandbox, which is derived from the workspace. */
	readonly name: string;
	/**
	 * Run a command inside the sandbox. A string goes through a shell; an array runs its
	 * program directly with the rest as arguments, without a shell to parse them. Chunks
	 * arrive as they are produced.
	 */
	exec(command: string | readonly string[], options: ExecOptions): Promise<ExecResult>;
	/** File contents, or an error: unlike `read`, a missing file is a failure here. */
	readBytes(path: string): Promise<Uint8Array>;
	write(path: string, content: string | Uint8Array): Promise<void>;
	writeStream(path: string): Promise<WriteSink>;
	mkdir(path: string): Promise<void>;
	remove(path: string, options: { recursive?: boolean; force?: boolean }): Promise<void>;
	rename(from: string, to: string): Promise<void>;
}

/**
 * An engine's module: its name, and how to open a workspace with it. The worker matches the
 * name control sends against this interface, so the two sides of one install cannot disagree
 * about which engine is in use.
 */
export interface SandboxEngine {
	engineName(): string;
	openSandbox(name: string, workspace: string): Promise<SandboxClient>;
}

export interface ExecChunk {
	stream: "stdout" | "stderr";
	data: Uint8Array;
}

export interface ExecOptions {
	cwd?: string;
	env?: Record<string, string>;
	/** Start from an empty environment instead of the guest's own. */
	clearEnv?: boolean;
	/** Milliseconds; the command is killed when it runs longer. */
	timeoutMs?: number;
	/** Aborting kills the command, inside the sandbox, and reports "aborted". */
	signal?: AbortSignal;
	onChunk?: (chunk: ExecChunk) => void;
}

export interface ExecResult {
	code: number;
	stdout: Uint8Array;
	stderr: Uint8Array;
	/** Set when we stopped the command rather than it finishing: exit codes cannot say why. */
	stopped?: "aborted" | "timeout";
}

export interface DirEntry {
	name: string;
	directory: boolean;
	size: number;
	mtimeMs: number;
}

export interface WriteSink {
	write(data: string | Uint8Array): Promise<void>;
	close(): Promise<void>;
}

/**
 * What the worker gets when there is no sandbox: reads find nothing and everything else
 * fails with the reason.
 *
 * This is the refusal. Running tools on the host because the sandbox was unavailable would
 * make the sandbox advisory, and "unconfined" would be a state the system drifted into
 * rather than a decision somebody made.
 */
/**
 * What a workspace with no sandbox refuses with. Control sends the reason it could not make one — a folder
 * outside the machine's share root, an engine that is not installed — and a person reading the transcript
 * gets that sentence instead of being told only that tools are off.
 */
export function noSandboxReason(problem: string): string {
	return problem === ""
		? "this workspace has no sandbox: tool execution is disabled"
		: `this workspace has no sandbox: ${problem}`;
}

/**
 * A sandbox that is opened lazily and tried again after a failure. The worker used to open its
 * sandbox once at startup and keep the refusal for its whole life: a container that was still
 * being created when the worker started — the ordinary race between control and the worker —
 * made every later tool say "this workspace has no sandbox", even after the container was
 * running. A transient failure is not a property of the workspace.
 *
 * Reads fall back to "nothing" while the sandbox is unreachable, the same shape the refused
 * sandbox had; commands and writes throw the underlying reason, and the next call opens again.
 */
export function retryingSandbox(open: () => Promise<SandboxClient>): SandboxClient {
	let client: SandboxClient | undefined;
	let opening: Promise<SandboxClient> | undefined;
	const current = async (): Promise<SandboxClient> => {
		if (client !== undefined) return client;
		opening ??= open()
			.then((next) => {
				client = next;
				return next;
			})
			.finally(() => {
				opening = undefined;
			});
		return await opening;
	};
	const orFallback = async <T>(fn: (c: SandboxClient) => Promise<T>, fallback: T): Promise<T> => {
		try {
			return await fn(await current());
		} catch {
			return fallback;
		}
	};
	const must = async <T>(fn: (c: SandboxClient) => Promise<T>): Promise<T> => {
		try {
			return await fn(await current());
		} catch (error) {
			const reason = error instanceof Error ? error.message : String(error);
			throw new Error(`this workspace's sandbox is not ready: ${reason}`);
		}
	};
	return {
		get name() {
			return client?.name ?? "";
		},
		read: (path) => orFallback((c) => c.read(path), null),
		list: (path) => orFallback((c) => c.list(path), []),
		stat: (path) => orFallback((c) => c.stat(path), null),
		readBytes: (path) => must((c) => c.readBytes(path)),
		exec: (command, options) => must((c) => c.exec(command, options)),
		write: (path, content) => must((c) => c.write(path, content)),
		writeStream: (path) => must((c) => c.writeStream(path)),
		mkdir: (path) => must((c) => c.mkdir(path)),
		remove: (path, options) => must((c) => c.remove(path, options)),
		rename: (from, to) => must((c) => c.rename(from, to)),
	};
}

export function refusedSandbox(reason: string): SandboxClient {
	const fail = (): never => {
		throw new Error(reason);
	};
	return {
		name: "",
		read: async () => null,
		list: async () => [],
		stat: async () => null,
		readBytes: async () => fail(),
		exec: async () => fail(),
		write: async () => fail(),
		writeStream: async () => fail(),
		mkdir: async () => fail(),
		remove: async () => fail(),
		rename: async () => fail(),
	};
}

export function concatChunks(chunks: readonly Uint8Array[]): Uint8Array {
	const total = chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0);
	const out = new Uint8Array(total);
	let offset = 0;
	for (const chunk of chunks) {
		out.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return out;
}
