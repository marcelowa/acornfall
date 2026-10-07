import type { Context } from "@earendil-works/chord";
import {
	ExecutionError,
	FileError,
	LineScanner,
	err,
	ok,
	type BinaryReader,
	type DirReader,
	type ExecutionEnv,
	type FileInfo,
	type FileWatcher,
	type Result,
	type ShellExecOptions,
	type ShellExecResult,
	type TextLine,
	type TextLineReader,
	type WatchChange,
	type WatchTarget,
} from "@earendil-works/pi-durable/env";
import type { ExecResult, SandboxClient } from "./sandbox.ts";

/**
 * The harness's execution environment, over a sandbox.
 *
 * `ExecutionEnv` is the seam durable built for exactly this: its tools — `read`, `write`,
 * `edit`, `bash`, and anything else that ships with it — touch files and processes only
 * through the call's environment. Point that at a sandbox and every tool the model has goes
 * inside it, without a tool knowing.
 *
 * The environment's `id` is the sandbox's name: equal ids see the same files at the same
 * paths, which is how the harness serializes two edits of one file. Two sandboxes do not
 * share a filesystem, so two ids must not either.
 */
export class SandboxExecutionEnv implements ExecutionEnv {
	readonly id: string;
	cwd: string;
	private readonly sandbox: SandboxClient;

	constructor(sandbox: SandboxClient, cwd: string) {
		this.sandbox = sandbox;
		this.id = `sandbox:${sandbox.name}`;
		this.cwd = cwd;
	}

	// -- paths ------------------------------------------------------------------------

	async absolutePath(path: string, _context: Context): Promise<Result<string, FileError>> {
		return ok(resolvePath(this.cwd, path));
	}

	async joinPath(parts: string[], _context: Context): Promise<Result<string, FileError>> {
		return ok(joinPaths(parts));
	}

	// -- running a command ------------------------------------------------------------

	async exec(
		command: string | readonly string[],
		options: ShellExecOptions | undefined,
		context: Context,
	): Promise<Result<ShellExecResult, ExecutionError>> {
		const signal = context.abortSignal;
		// A function, not a captured boolean: the signal is live, and a check made before the
		// command started says nothing about the state when it finished.
		const aborted = (): boolean => signal?.aborted === true;
		if (aborted()) return err(new ExecutionError("aborted", "aborted"));
		// The harness counts seconds; the engine counts milliseconds.
		const timeoutSeconds = options?.timeout;
		if (
			timeoutSeconds !== undefined &&
			(!Number.isFinite(timeoutSeconds) || timeoutSeconds <= 0)
		) {
			return err(
				new ExecutionError(
					"timeout",
					"Invalid timeout: a finite number of seconds is required",
				),
			);
		}
		const timeoutMs = timeoutSeconds === undefined ? undefined : timeoutSeconds * 1000;
		const cwd = options?.cwd === undefined ? this.cwd : resolvePath(this.cwd, options.cwd);

		// The harness gives up on a command whose output callback throws, so the command has to
		// be stopped: an abandoned command would keep running inside the sandbox with nobody
		// reading it. Aborting our own controller is what reaches the engine's kill.
		const stop = new AbortController();
		let callbackError: ExecutionError | undefined;
		// The caller's abort must reach the engine, which is what kills the process inside the
		// sandbox; the checks below then report why it ended.
		const abort = (): void => stop.abort();
		signal?.addEventListener("abort", abort, { once: true });

		const spill = options?.spill;
		let spillPath: string | undefined;
		let spillSink: Awaited<ReturnType<SandboxClient["writeStream"]>> | undefined;
		// Opening the spill file is asynchronous while output keeps arriving, so what arrives in
		// the meantime is held in order and written once the file exists. Without this the spill
		// file loses the beginning of the overflow, which is the part a reader wants.
		let opening: Promise<void> | undefined;
		let queued: string[] = [];
		let seen = "";
		let bytes = 0;
		let newlines = 0;

		const decoders = { stdout: new TextDecoder(), stderr: new TextDecoder() };
		const result = await this.sandbox
			.exec(command, {
				cwd,
				...(options?.env === undefined ? {} : { env: options.env }),
				...(options?.inheritEnv === false ? { clearEnv: true } : {}),
				...(timeoutMs === undefined ? {} : { timeoutMs }),
				signal: stop.signal,
				onChunk: (chunk) => {
					const piece = decoders[chunk.stream].decode(chunk.data, { stream: true });
					if (piece === "") return;
					seen += piece;
					bytes += byteLength(piece);
					newlines += countNewlines(piece);
					// The file is opened lazily: a command that stays small never touches the
					// sandbox's disk, and what came before the threshold goes in first.
					const crossing =
						spill !== undefined &&
						opening === undefined &&
						(bytes >= spill.afterBytes || newlines >= spill.afterLines);
					if (crossing) {
						const prefix = seen;
						opening = this.openSpill(prefix).then((opened) => {
							spillPath = opened.path;
							spillSink = opened.sink;
							return undefined;
						});
					} else if (opening !== undefined) {
						if (spillSink === undefined) queued.push(piece);
						else void spillSink.write(piece).catch(() => {});
					}
					if (callbackError !== undefined || options?.onOutput === undefined) return;
					try {
						options.onOutput(piece, context, { stream: chunk.stream });
					} catch (error) {
						callbackError = new ExecutionError("callback_error", message(error));
						stop.abort();
					}
				},
			})
			.catch((error: unknown): ExecResult | Error => asError(error));
		signal?.removeEventListener("abort", abort);

		// Anything decoded after the last chunk, from either stream, plus the spill file's tail.
		const tail = decoders.stdout.decode() + decoders.stderr.decode();
		if (tail !== "") {
			seen += tail;
			if (opening !== undefined && spillSink === undefined) queued.push(tail);
			else if (spillSink !== undefined) await spillSink.write(tail).catch(() => {});
		}
		if (opening !== undefined) {
			await opening;
			for (const piece of queued) await spillSink?.write(piece).catch(() => {});
			queued = [];
			await spillSink?.close().catch(() => {});
		}
		if (result instanceof Error)
			return err(new ExecutionError("spawn_error", message(result), result));
		if (callbackError !== undefined) return err(callbackError);
		if (result.stopped === "aborted") return err(new ExecutionError("aborted", "aborted"));
		// The caller's signal can fire after the command finished; that is not an abort.
		if (result.code !== 0 && aborted()) return err(new ExecutionError("aborted", "aborted"));
		if (result.stopped === "timeout") {
			const timeout = new ExecutionError(
				"timeout",
				`Command timed out after ${options?.timeout ?? 0}s`,
			);
			if (spillPath !== undefined) timeout.spillPath = spillPath;
			return err(timeout);
		}
		return ok({ exitCode: result.code, ...(spillPath === undefined ? {} : { spillPath }) });
	}

	/** Open the spill file in the sandbox and put what happened before the threshold in it. */
	private async openSpill(prefix: string): Promise<{
		path: string;
		sink: Awaited<ReturnType<SandboxClient["writeStream"]>> | undefined;
	}> {
		const scratch = await this.sandbox
			.exec("mktemp /tmp/acornfall-output.XXXXXX", {})
			.catch(() => null);
		if (scratch === null || scratch.code !== 0) return { path: "", sink: undefined };
		const path = text(scratch.stdout).trim();
		const sink = await this.sandbox.writeStream(path).catch(() => null);
		if (sink === null) return { path, sink: undefined };
		await sink.write(prefix).catch(() => {});
		return { path, sink };
	}

	// -- files ------------------------------------------------------------------------

	async readTextFile(path: string, _context: Context): Promise<Result<string, FileError>> {
		const resolved = resolvePath(this.cwd, path);
		const contents = await this.sandbox.read(resolved);
		if (contents === null)
			return err(
				new FileError("not_found", `No such file or directory: ${resolved}`, resolved),
			);
		return ok(contents);
	}

	async readBinaryFile(path: string, context: Context): Promise<Result<Uint8Array, FileError>> {
		const contents = await this.readTextFile(path, context);
		if (!contents.ok) return contents;
		return ok(Buffer.from(contents.value, "utf8"));
	}

	async readTextLines(
		path: string,
		options: { maxLines?: number } | undefined,
		context: Context,
	): Promise<Result<string[], FileError>> {
		const contents = await this.readTextFile(path, context);
		if (!contents.ok) return contents;
		const lines = contents.value.split("\n");
		if (lines.at(-1) === "") lines.pop();
		return ok(options?.maxLines === undefined ? lines : lines.slice(0, options.maxLines));
	}

	async openTextLineReader(
		path: string,
		context: Context,
	): Promise<Result<TextLineReader, FileError>> {
		const contents = await this.readTextFile(path, context);
		if (!contents.ok) return contents;
		const lines = contents.value.split("\n");
		if (lines.at(-1) === "") lines.pop();
		let index = 0;
		return ok({
			readLine: async (
				_context: Context,
			): Promise<Result<TextLine | undefined, FileError>> => {
				if (index >= lines.length) return ok(undefined);
				const text = lines[index] ?? "";
				index += 1;
				return ok({ text, terminated: true });
			},
			close: async (_context: Context): Promise<void> => {},
		});
	}

	// -- opened files and directories --------------------------------------------------

	/**
	 * Open a file for positional reads, as a snapshot of its bytes.
	 *
	 * The engine contract has no file handle: every operation names a path, and a rename
	 * would change what "the opened file" means. A snapshot is what keeps the file open
	 * across the boundary, the same one-read shape the text operations above already have,
	 * and the reader then serves every range — including `scanLines`' single pass — from it.
	 */
	async openBinaryReader(
		path: string,
		options: { noFollow?: boolean } | undefined,
		context: Context,
	): Promise<Result<BinaryReader, FileError>> {
		const resolved = resolvePath(this.cwd, path);
		if (isAborted(context)) return err(abortedFileError(resolved));
		const info = await this.sandbox.stat(resolved);
		if (info === null)
			return err(
				new FileError("not_found", `No such file or directory: ${resolved}`, resolved),
			);
		if (info.directory)
			return err(new FileError("is_directory", `Is a directory: ${resolved}`, resolved));
		if (options?.noFollow === true && (await this.isSymlink(resolved))) {
			return err(new FileError("invalid", "Refusing to follow a symbolic link", resolved));
		}
		let bytes: Uint8Array;
		try {
			bytes = await this.sandbox.readBytes(resolved);
		} catch (error) {
			return err(new FileError(codeFor(message(error)), message(error), resolved));
		}
		if (isAborted(context)) return err(abortedFileError(resolved));

		const name = baseName(resolved);
		let closed = false;
		const reader: BinaryReader = {
			info: async (inner) => {
				if (isAborted(inner)) return err(abortedFileError(resolved));
				if (closed) return err(closedFileError(resolved));
				return ok({
					name,
					path: resolved,
					kind: "file",
					size: bytes.byteLength,
					mtimeMs: info.mtimeMs,
				});
			},
			read: async (offset, length, inner) => {
				if (isAborted(inner)) return err(abortedFileError(resolved));
				if (closed) return err(closedFileError(resolved));
				if (
					!Number.isSafeInteger(offset) ||
					offset < 0 ||
					!Number.isSafeInteger(length) ||
					length < 0
				) {
					return err(
						new FileError(
							"invalid",
							"Offset and length must be non-negative safe integers",
							resolved,
						),
					);
				}
				return ok(bytes.subarray(offset, offset + length));
			},
			scanLines: async (scan, inner) => {
				if (isAborted(inner)) return err(abortedFileError(resolved));
				if (closed) return err(closedFileError(resolved));
				let scanner: LineScanner;
				try {
					scanner = new LineScanner(scan.startLine, scan.endLine);
				} catch {
					return err(new FileError("invalid", "Invalid line range", resolved));
				}
				scanner.push(bytes);
				return ok(scanner.finish());
			},
			close: async () => {
				closed = true;
			},
		};
		return ok(reader);
	}

	async openDirReader(path: string, context: Context): Promise<Result<DirReader, FileError>> {
		const resolved = resolvePath(this.cwd, path);
		if (isAborted(context)) return err(abortedFileError(resolved));
		const info = await this.sandbox.stat(resolved);
		if (info === null)
			return err(new FileError("not_found", `No such directory: ${resolved}`, resolved));
		if (!info.directory)
			return err(new FileError("not_directory", `Not a directory: ${resolved}`, resolved));

		let entries: FileInfo[] | undefined;
		let index = 0;
		let closed = false;
		const reader: DirReader = {
			next: async (maxEntries, inner) => {
				if (isAborted(inner)) return err(abortedFileError(resolved));
				if (closed) return err(closedFileError(resolved));
				if (!Number.isSafeInteger(maxEntries) || maxEntries <= 0) {
					return err(
						new FileError(
							"invalid",
							"maxEntries must be a positive safe integer",
							resolved,
						),
					);
				}
				// Listed on the first page, not at open: an entry removed before the reader is
				// used is gone, and a directory nobody lists costs nothing.
				entries ??= (await this.sandbox.list(resolved)).map((entry) => ({
					name: entry.name,
					path: joinPaths([resolved, entry.name]),
					kind: entry.directory ? ("directory" as const) : ("file" as const),
					size: entry.size,
					mtimeMs: entry.mtimeMs,
				}));
				if (index >= entries.length) return ok({ entries: [], done: true });
				const page = entries.slice(index, index + maxEntries);
				index += page.length;
				return ok({ entries: page, done: index >= entries.length });
			},
			close: async () => {
				closed = true;
			},
		};
		return ok(reader);
	}

	/**
	 * Watch by comparing snapshots on a timer.
	 *
	 * The engine reports no changes of its own, so this is the polling mode the interface
	 * keeps for file systems that cannot: a change undone between two snapshots is missed,
	 * and everything else is reported. It is what a sandbox across a hypervisor boundary can
	 * honestly promise.
	 */
	async watch(
		targets: readonly WatchTarget[],
		onChange: (change: WatchChange) => void,
		context: Context,
	): Promise<Result<FileWatcher, FileError>> {
		if (isAborted(context)) return err(abortedFileError(""));
		let snapshot = await this.snapshotTargets(targets);
		let stopped = false;
		let polling = false;
		const poll = async (): Promise<void> => {
			if (stopped || polling) return;
			polling = true;
			try {
				const next = await this.snapshotTargets(targets);
				if (stopped) return;
				const changed: string[] = [];
				for (const [path, state] of next) {
					if (snapshot.get(path) !== state) changed.push(path);
				}
				for (const path of snapshot.keys()) {
					if (!next.has(path)) changed.push(path);
				}
				snapshot = next;
				if (changed.length > 0) onChange({ paths: changed });
			} finally {
				polling = false;
			}
		};
		const timer = setInterval(() => void poll(), WATCH_INTERVAL_MS);
		timer.unref?.();
		const onAbort = (): void => {
			stopped = true;
			clearInterval(timer);
		};
		context.abortSignal?.addEventListener("abort", onAbort, { once: true });
		return ok({
			mode: "polling",
			close: async () => {
				stopped = true;
				clearInterval(timer);
				context.abortSignal?.removeEventListener("abort", onAbort);
			},
		});
	}

	/** Every path under the targets, with a state string that changes when the entry does. */
	private async snapshotTargets(targets: readonly WatchTarget[]): Promise<Map<string, string>> {
		const snapshot = new Map<string, string>();
		for (const target of targets) {
			await this.snapshotTarget(resolvePath(this.cwd, target.path), target, snapshot);
		}
		return snapshot;
	}

	private async snapshotTarget(
		path: string,
		target: WatchTarget,
		snapshot: Map<string, string>,
	): Promise<void> {
		const info = await this.sandbox.stat(path);
		if (info === null) return;
		snapshot.set(path, fingerprint(info));
		if (!info.directory) return;
		const entries = await this.sandbox.list(path);
		for (const entry of entries) {
			if (isExcluded(entry.name, target.exclude)) continue;
			const child = joinPaths([path, entry.name]);
			snapshot.set(child, fingerprint(entry));
			if (target.recursive === true && entry.directory) {
				await this.snapshotTarget(child, target, snapshot);
			}
		}
	}

	/** Whether the final path component is a symbolic link, asked inside the sandbox. */
	private async isSymlink(path: string): Promise<boolean> {
		const result = await this.sandbox.exec(["test", "-L", path], {}).catch(() => null);
		return result !== null && result.code === 0;
	}

	async writeFile(
		path: string,
		content: string | Uint8Array,
		_context: Context,
	): Promise<Result<void, FileError>> {
		const resolved = resolvePath(this.cwd, path);
		return this.attempt(resolved, async () => {
			// The reference environment makes a write's parents; a tool that writes a file under a
			// new folder should not have to know to make it first.
			await this.ensureParent(resolved);
			await this.sandbox.write(resolved, content);
		});
	}

	async appendFile(
		path: string,
		content: string | Uint8Array,
		_context: Context,
	): Promise<Result<void, FileError>> {
		const resolved = resolvePath(this.cwd, path);
		return this.attempt(resolved, async () => {
			// The engine writes and truncates; there is no append. So the file has to come back
			// through this process to be extended, which is the cost of not having one.
			await this.ensureParent(resolved);
			const existing = await this.sandbox.readBytes(resolved).catch(() => new Uint8Array());
			const suffix = typeof content === "string" ? Buffer.from(content, "utf8") : content;
			await this.sandbox.write(
				resolved,
				Buffer.concat([Buffer.from(existing), Buffer.from(suffix)]),
			);
		});
	}

	async truncateFile(
		path: string,
		size: number,
		_context: Context,
	): Promise<Result<void, FileError>> {
		const resolved = resolvePath(this.cwd, path);
		const bytes = Math.max(0, Math.floor(size));
		const result = await this.sandbox
			.exec(`truncate -s ${bytes} -- ${quote(resolved)}`, {})
			.catch((error: unknown): ExecResult | Error => asError(error));
		if (result instanceof Error)
			return err(new FileError(codeFor(message(result)), message(result), resolved));
		if (result.code !== 0)
			return err(new FileError(codeFor(text(result.stderr)), text(result.stderr), resolved));
		return ok(undefined);
	}

	async flushFile(_path: string, _context: Context): Promise<Result<void, FileError>> {
		// Every write is complete when the engine returns, so there is no buffer of ours left.
		return ok(undefined);
	}

	async renameFile(
		sourcePath: string,
		destinationPath: string,
		_context: Context,
	): Promise<Result<void, FileError>> {
		const source = resolvePath(this.cwd, sourcePath);
		const destination = resolvePath(this.cwd, destinationPath);
		return this.attempt(source, async () => {
			await this.sandbox.rename(source, destination);
		});
	}

	async fileInfo(path: string, _context: Context): Promise<Result<FileInfo, FileError>> {
		const resolved = resolvePath(this.cwd, path);
		const info = await this.sandbox.stat(resolved);
		if (info === null)
			return err(
				new FileError("not_found", `No such file or directory: ${resolved}`, resolved),
			);
		return ok({
			name: baseName(resolved),
			path: resolved,
			kind: info.directory ? "directory" : "file",
			size: info.size,
			mtimeMs: info.mtimeMs,
		});
	}

	async listDir(path: string, _context: Context): Promise<Result<FileInfo[], FileError>> {
		const resolved = resolvePath(this.cwd, path);
		const info = await this.sandbox.stat(resolved);
		if (info === null)
			return err(new FileError("not_found", `No such directory: ${resolved}`, resolved));
		if (!info.directory)
			return err(new FileError("not_directory", `Not a directory: ${resolved}`, resolved));
		const entries = await this.sandbox.list(resolved);
		return ok(
			entries.map((entry) => ({
				name: entry.name,
				path: joinPaths([resolved, entry.name]),
				kind: entry.directory ? ("directory" as const) : ("file" as const),
				size: entry.size,
				mtimeMs: entry.mtimeMs,
			})),
		);
	}

	async canonicalPath(path: string, _context: Context): Promise<Result<string, FileError>> {
		// Resolution happens inside the sandbox, where the file is: a host-side answer would be
		// about a path that does not exist there.
		const resolved = resolvePath(this.cwd, path);
		const result = await this.sandbox
			.exec(`readlink -f -- ${quote(resolved)}`, {})
			.catch(() => null);
		if (result === null || result.code !== 0) return ok(resolved);
		const canonical = text(result.stdout).trim();
		return ok(canonical === "" ? resolved : canonical);
	}

	async exists(path: string, _context: Context): Promise<Result<boolean, FileError>> {
		return ok((await this.sandbox.stat(resolvePath(this.cwd, path))) !== null);
	}

	async createDir(
		path: string,
		options: { recursive?: boolean } | undefined,
		_context: Context,
	): Promise<Result<void, FileError>> {
		const resolved = resolvePath(this.cwd, path);
		if (options?.recursive !== true) {
			const parent = dirName(resolved);
			if ((await this.sandbox.stat(parent)) === null) {
				return err(new FileError("not_found", `No such directory: ${parent}`, parent));
			}
		}
		return this.attempt(resolved, async () => {
			await this.sandbox.mkdir(resolved);
		});
	}

	async remove(
		path: string,
		options: { recursive?: boolean; force?: boolean } | undefined,
		_context: Context,
	): Promise<Result<void, FileError>> {
		const resolved = resolvePath(this.cwd, path);
		const info = await this.sandbox.stat(resolved);
		if (info === null) {
			if (options?.force === true) return ok(undefined);
			return err(
				new FileError("not_found", `No such file or directory: ${resolved}`, resolved),
			);
		}
		if (info.directory && options?.recursive !== true) {
			return err(new FileError("is_directory", `Is a directory: ${resolved}`, resolved));
		}
		return this.attempt(resolved, async () => {
			await this.sandbox.remove(resolved, { recursive: options?.recursive === true });
		});
	}

	async createTempDir(
		prefix: string | undefined,
		_context: Context,
	): Promise<Result<string, FileError>> {
		return this.temp(prefix ?? "acornfall-dir", true);
	}

	async createTempFile(
		options: { prefix?: string; suffix?: string } | undefined,
		_context: Context,
	): Promise<Result<string, FileError>> {
		return this.temp(options?.prefix ?? "acornfall-tmp", false);
	}

	private async temp(name: string, directory: boolean): Promise<Result<string, FileError>> {
		const template = `/tmp/${name}.XXXXXX`;
		const command = directory ? `mktemp -d ${quote(template)}` : `mktemp ${quote(template)}`;
		const result = await this.sandbox
			.exec(command, {})
			.catch((error: unknown): ExecResult | Error => asError(error));
		if (result instanceof Error)
			return err(new FileError("unknown", message(result), template));
		const path = text(result.stdout).trim();
		if (result.code !== 0 || path === "") {
			return err(new FileError("unknown", text(result.stderr) || "mktemp failed", template));
		}
		return ok(path);
	}

	// Temp files are the sandbox's own /tmp: they are already inside the boundary, and they
	// disappear when the sandbox's disk does. Nothing here has a buffer to release.
	async cleanup(_context: Context): Promise<void> {}

	/** Create the directories a write needs, nearest first, inside the sandbox. */
	private async ensureParent(path: string): Promise<void> {
		const parent = dirName(path);
		if (parent === "/" || parent === "." || parent === path) return;
		if ((await this.sandbox.stat(parent)) !== null) return;
		await this.ensureParent(parent);
		await this.sandbox.mkdir(parent);
	}

	/** Wrap a file operation the way the harness expects: failures returned, never thrown. */
	private async attempt<T>(
		path: string,
		operation: () => Promise<T>,
	): Promise<Result<T, FileError>> {
		try {
			return ok(await operation());
		} catch (error) {
			return err(new FileError(codeFor(message(error)), message(error), path));
		}
	}
}

// -- helpers -------------------------------------------------------------------------

/** Path resolution is string work: a sandbox path and a host path are the same string. */
export function resolvePath(cwd: string, path: string): string {
	if (path.startsWith("/")) return normalize(path);
	return normalize(`${cwd}/${path}`);
}

function joinPaths(parts: readonly string[]): string {
	return normalize(parts.filter((part) => part !== "").join("/"));
}

function normalize(path: string): string {
	const absolute = path.startsWith("/");
	const out: string[] = [];
	for (const part of path.split("/")) {
		if (part === "" || part === ".") continue;
		if (part === "..") {
			if (out.length > 0 && out.at(-1) !== "..") out.pop();
			else if (!absolute) out.push("..");
			continue;
		}
		out.push(part);
	}
	const joined = out.join("/");
	if (absolute) return joined === "" ? "/" : `/${joined}`;
	return joined === "" ? "." : joined;
}

function dirName(path: string): string {
	const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
	const index = trimmed.lastIndexOf("/");
	if (index < 0) return ".";
	if (index === 0) return "/";
	return trimmed.slice(0, index);
}

function baseName(path: string): string {
	const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
	const index = trimmed.lastIndexOf("/");
	return index < 0 ? trimmed : trimmed.slice(index + 1);
}

function countNewlines(value: string): number {
	let count = 0;
	for (const character of value) if (character === "\n") count += 1;
	return count;
}

function byteLength(value: string): number {
	// UTF-8 length without allocating: the spill thresholds count bytes on the wire.
	let length = 0;
	for (const character of value) {
		const code = character.codePointAt(0) ?? 0;
		length += code < 0x80 ? 1 : code < 0x800 ? 2 : code < 0x10000 ? 3 : 4;
	}
	return length;
}

function text(bytes: Uint8Array): string {
	return new TextDecoder().decode(bytes);
}

function asError(error: unknown): Error {
	return error instanceof Error ? error : new Error(String(error));
}

function message(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function codeFor(message: string): FileError["code"] {
	const text = message.toLowerCase();
	if (
		text.includes("no such file") ||
		text.includes("not found") ||
		text.includes("no such directory")
	)
		return "not_found";
	if (text.includes("permission") || text.includes("denied") || text.includes("read-only"))
		return "permission_denied";
	if (text.includes("is a directory")) return "is_directory";
	if (text.includes("not a directory")) return "not_directory";
	if (text.includes("not supported") || text.includes("unsupported")) return "not_supported";
	return "unknown";
}

/** Quote a path for the guest shell: single quotes, with the one escape that works. */
function quote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}

// -- reader and watch helpers ---------------------------------------------------------

/** How often a watch compares snapshots; the mode is honest, the latency should not be. */
const WATCH_INTERVAL_MS = 100;

/** A state string that changes when an entry's contents or identity do. */
function fingerprint(info: { directory: boolean; size: number; mtimeMs: number }): string {
	return `${info.directory ? "d" : "f"}:${info.size}:${info.mtimeMs}`;
}

function isExcluded(name: string, exclude: WatchTarget["exclude"]): boolean {
	if (exclude?.hidden === true && name.startsWith(".")) return true;
	return exclude?.names?.includes(name) === true;
}

function isAborted(context: Context): boolean {
	return context.abortSignal?.aborted === true;
}

function abortedFileError(path: string): FileError {
	return new FileError("aborted", "aborted", path);
}

function closedFileError(path: string): FileError {
	return new FileError("invalid", "Reader is closed", path);
}
