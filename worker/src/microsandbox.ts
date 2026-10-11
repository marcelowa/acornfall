import { Sandbox, SandboxNotRunningError } from "microsandbox";
import {
	concatChunks,
	type DirEntry,
	type ExecOptions,
	type ExecResult,
	type SandboxClient,
	type WriteSink,
} from "./sandbox.ts";

/**
 * The microsandbox engine: libkrun microVMs.
 *
 * This is the only file that imports the SDK. Everything else in the worker talks to
 * `SandboxClient`, which is what makes the engine replaceable — and what keeps the SDK's
 * native addon, its connection model, and its error shapes in one place.
 *
 * Control created the sandbox with the engine's command line; this side attaches to it. Both
 * find it through the engine's own store, which the gateway points at with MSB_HOME when it
 * starts the worker.
 */
export function engineName(): string {
	return "microsandbox";
}

/**
 * The engine release this build is pinned to, matching the gateway's own pin
 * (gateway/internal/sandbox: `Version`). The CLI and the SDK share their on-disk
 * state, including the catalog's migrations — so a worker whose SDK is newer or
 * older than the gateway's engine must refuse rather than migrate the live store
 * out from under the pinned binary (2026-10-11: a 0.7.7 SDK rowed the catalog
 * forward and 0.7.6 could no longer read it).
 */
export const ENGINE_VERSION = "0.7.6";

/**
 * Refuse a loaded SDK that is not the pinned engine: its first write would migrate
 * the shared catalog, and the gateway's pinned binary would then refuse the store.
 *
 * The version is read from the resolved package, not asserted from our own
 * package.json: what matters is the module that actually loaded, including its
 * native parts. Injected for tests, which must not read this install's packages.
 */
export async function checkEngineVersion(
	readPackage: () => Promise<{ version?: unknown }> = defaultReadPackage,
): Promise<void> {
	const pkg = await readPackage().catch(() => null);
	const version = typeof pkg?.version === "string" ? pkg.version : "";
	if (version !== ENGINE_VERSION) {
		throw new Error(
			`the loaded microsandbox SDK is ${version === "" ? "unknown" : version}, want ${ENGINE_VERSION}: refusing, so it cannot migrate the engine store`,
		);
	}
}

async function defaultReadPackage(): Promise<{ version?: unknown }> {
	const resolved = Bun.resolveSync("microsandbox/package.json", import.meta.dir);
	const file = Bun.file(resolved);
	return (await file.json()) as { version?: unknown };
}

/**
 * Open a workspace's sandbox, waking it when the engine stopped it for being idle.
 *
 * `connect()` attaches to a running sandbox only; a stopped one answers with
 * `sandboxNotRunning`. The engine stops idle sandboxes on its own (30m), while the
 * gateway keeps a watched workspace's worker alive past that, so a worker whose
 * session died under it is the normal state after half an hour of quiet — not a
 * failure. `connectOrStart` wakes that sandbox instead of failing, detached so the
 * worker attaches without taking lifecycle ownership: control owns the lifecycle
 * from the command line, and the worker must not. See issue #58.
 */
export async function openSandbox(name: string, _workspace: string): Promise<SandboxClient> {
	// First, so a wrong SDK never touches the shared store: its first write would
	// migrate the catalog past what the gateway's pinned engine can read.
	await checkEngineVersion();
	const handle = await Sandbox.get(name);
	return new MicrosandboxClient(name, handle, await handle.connectOrStart({ detached: true }));
}

/**
 * The engine's handle: stable across stops, and what wakes a stopped sandbox.
 * Exported for tests, which drive the client over fakes.
 */
export type MicrosandboxHandle = Awaited<ReturnType<typeof Sandbox.get>>;
/**
 * The attached session: the SDK's type, named once so the rest of the class can use it.
 * Exported for tests, which drive the client over fakes.
 */
export type MicrosandboxSession = Awaited<ReturnType<MicrosandboxHandle["connect"]>>;

/**
 * Whether an operation failed because its session died under it: the engine stops idle
 * sandboxes on its own, so this is the normal state after half an hour of quiet.
 *
 * Three shapes because the failure crosses a native boundary: the mapped error class, its
 * code for a copy from another module instance, and the native message itself. A genuine
 * missing file is `sandboxFsOps` with an os error 2, never this, so the two are told apart.
 * Anything else — a replacement behind the same name, a real failure — is not a wake.
 */
export function isStoppedError(error: unknown): boolean {
	if (error instanceof SandboxNotRunningError) return true;
	if (typeof error === "object" && error !== null && "code" in error) {
		if (error.code === "sandboxNotRunning") return true;
	}
	const message = error instanceof Error ? error.message : String(error);
	return message.includes("has no agent endpoint");
}

/**
 * Swallow an SDK failure into its fallback — unless the session died under it, which
 * rethrows so the session renews and the call retries. Only a genuine absence answers
 * null or empty; otherwise every outage reads as "no file" (issue #58).
 */
function unlessStopped<T>(fallback: T): (error: unknown) => T {
	return (error: unknown) => {
		if (isStoppedError(error)) throw error;
		return fallback;
	};
}

/**
 * One workspace's attached sandbox. Exported for tests, which construct it over
 * fakes; production uses openSandbox above.
 */
export class MicrosandboxClient implements SandboxClient {
	readonly name: string;
	private readonly handle: MicrosandboxHandle;
	private session: MicrosandboxSession;
	/**
	 * The in-flight wake, shared by every caller that finds a dead session at once:
	 * parallel tool calls must join one boot, not start one each.
	 */
	private waking: Promise<MicrosandboxSession> | undefined;

	constructor(name: string, handle: MicrosandboxHandle, session: MicrosandboxSession) {
		this.name = name;
		this.handle = handle;
		this.session = session;
	}

	/**
	 * Run an operation against the session, waking the sandbox and retrying once when
	 * the session died under a live worker: the engine stops idle sandboxes itself,
	 * while the gateway keeps a watched workspace's worker alive past that.
	 *
	 * One retry, not a loop: a sandbox that stops again between the wake and the call
	 * is reported, and the next call wakes again. Anything that is not a stopped
	 * sandbox — a same-name replacement, a real failure — is never retried: running
	 * the call on a different machine behind the same name would be the wrong answer
	 * rather than a wake.
	 */
	private async withSession<T>(
		operation: (session: MicrosandboxSession) => Promise<T>,
	): Promise<T> {
		try {
			return await operation(this.session);
		} catch (error) {
			if (!isStoppedError(error)) throw error;
			const woken = await this.wake();
			return await operation(woken);
		}
	}

	/** Wake a stopped sandbox and re-attach, joining an in-flight wake when one exists. */
	private wake(): Promise<MicrosandboxSession> {
		this.waking ??= this.doWake();
		return this.waking;
	}

	private async doWake(): Promise<MicrosandboxSession> {
		try {
			const session = await this.handle.connectOrStart({ detached: true });
			this.session = session;
			return session;
		} finally {
			this.waking = undefined;
		}
	}

	async exec(command: string | readonly string[], options: ExecOptions): Promise<ExecResult> {
		// A string is a shell script; an array is a program and its arguments. Clearing the
		// environment is `env -i` in both forms, so an argv reaches its program unparsed and a
		// script keeps the variables the caller named.
		let program = "/bin/sh";
		let args: string[];
		if (typeof command === "string") {
			args = [
				"-c",
				options.clearEnv === true ? clearEnvScript(command, options.env) : command,
			];
		} else {
			const [first, ...rest] = command;
			if (first === undefined) throw new Error("empty argv: no program to run");
			if (options.clearEnv === true) {
				program = "env";
				args = [
					"-i",
					...Object.entries(options.env ?? {}).map(([key, value]) => `${key}=${value}`),
					first,
					...rest,
				];
			} else {
				program = first;
				args = rest;
			}
		}
		// Acquired through the session wrapper: a sandbox the engine stopped for being
		// idle wakes here, and the command runs on the woken session. Only the
		// acquisition retries — a command that started is never run twice.
		const handle = await this.withSession((session) =>
			session.execStreamWith(program, (builder) => {
				let configured = builder.args(args);
				if (options.cwd !== undefined) configured = configured.cwd(options.cwd);
				for (const [key, value] of Object.entries(options.env ?? {}))
					configured = configured.env(key, value);
				return configured;
			}),
		);
		const stdout: Uint8Array[] = [];
		const stderr: Uint8Array[] = [];
		let stopped: "aborted" | "timeout" | undefined;
		// The exit code arrives as the stream's last event. Calling the SDK's wait() after the
		// stream drained is a second reader for the same event, and it reports "exec session
		// ended without exit event" for every command that succeeded — so a run that looked
		// fine to a reader who only checked the output was an error to the model that read it.
		let exitCode: number | undefined;
		const stop = (reason: "aborted" | "timeout"): void => {
			if (stopped !== undefined) return;
			stopped = reason;
			// Killing inside the sandbox is the point: killing the host side leaves the guest
			// process running, so an aborted command would keep going with nobody reading it.
			void handle.kill().catch(() => {});
		};
		const abort = (): void => stop("aborted");
		let timer: ReturnType<typeof setTimeout> | undefined;
		if (options.signal?.aborted === true) abort();
		else options.signal?.addEventListener("abort", abort, { once: true });
		if (options.timeoutMs !== undefined && options.timeoutMs > 0) {
			timer = setTimeout(() => stop("timeout"), options.timeoutMs);
		}
		try {
			for await (const event of handle) {
				if (event.kind === "exited") {
					exitCode = event.code;
					continue;
				}
				if (event.kind !== "stdout" && event.kind !== "stderr") continue;
				(event.kind === "stdout" ? stdout : stderr).push(event.data);
				options.onChunk?.({ stream: event.kind, data: event.data });
			}
		} finally {
			if (timer !== undefined) clearTimeout(timer);
			options.signal?.removeEventListener("abort", abort);
		}
		const code = stopped === undefined ? exitCode : 143;
		if (code === undefined) {
			throw new Error("the sandbox ended the exec stream without an exit event");
		}
		return {
			code,
			stdout: concatChunks(stdout),
			stderr: concatChunks(stderr),
			...(stopped === undefined ? {} : { stopped }),
		};
	}

	async read(path: string): Promise<string | null> {
		return await this.withSession((session) =>
			session.fs().readToString(path).catch(unlessStopped(null)),
		);
	}

	async readBytes(path: string): Promise<Uint8Array> {
		return await this.withSession((session) => session.fs().read(path));
	}

	async write(path: string, content: string | Uint8Array): Promise<void> {
		await this.withSession((session) => session.fs().write(path, content));
	}

	async writeStream(path: string): Promise<WriteSink> {
		const sink = await this.withSession((session) => session.fs().writeStream(path));
		return { write: (data) => sink.write(data), close: () => sink.close() };
	}

	async list(path: string): Promise<DirEntry[]> {
		const entries = await this.withSession((session) =>
			session.fs().list(path).catch(unlessStopped([])),
		);
		return entries.map((entry) => ({
			name: baseName(entry.path),
			directory: entry.kind === "directory",
			size: entry.size,
			mtimeMs: entry.modified?.getTime() ?? 0,
		}));
	}

	async stat(
		path: string,
	): Promise<{ directory: boolean; size: number; mtimeMs: number } | null> {
		const info = await this.withSession((session) =>
			session.fs().stat(path).catch(unlessStopped(null)),
		);
		if (info === null) return null;
		return {
			directory: info.kind === "directory",
			size: info.size,
			mtimeMs: info.modified?.getTime() ?? 0,
		};
	}

	async mkdir(path: string): Promise<void> {
		// Best-effort, as before: making a write's parents must not fail a write.
		// A stopped sandbox still wakes — the write that follows needs it alive.
		await this.withSession((session) =>
			session.fs().mkdir(path).catch(unlessStopped(undefined)),
		);
	}

	async remove(path: string, options: { recursive?: boolean; force?: boolean }): Promise<void> {
		await this.withSession((session) => {
			const fs = session.fs();
			return (options.recursive === true ? fs.removeDir(path) : fs.remove(path)).catch(
				unlessStopped(undefined),
			);
		});
	}

	async rename(from: string, to: string): Promise<void> {
		await this.withSession((session) => session.fs().rename(from, to));
	}
}

function baseName(path: string): string {
	const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
	const index = trimmed.lastIndexOf("/");
	return index < 0 ? trimmed : trimmed.slice(index + 1);
}

/**
 * A script that runs `command` under `/bin/sh` with an empty environment plus `env`.
 *
 * The indirection is the point: `env -i printf one; printf two` would clear only the first
 * statement's environment, because the outer shell parses the `;` before `env` ever runs.
 */
function clearEnvScript(command: string, env: Record<string, string> | undefined): string {
	const assignments = Object.entries(env ?? {}).map(
		([key, value]) => `${quote(key)}=${quote(value)}`,
	);
	const prefix = assignments.length === 0 ? "" : `${assignments.join(" ")} `;
	return `exec env -i ${prefix}/bin/sh -c ${quote(command)}`;
}

/** Single quotes, with the one escape that survives them. */
function quote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}
