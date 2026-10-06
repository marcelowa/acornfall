import type { Context } from "@earendil-works/chord";
import {
	ExecutionError,
	FileError,
	err,
	ok,
	type ExecutionEnv,
	type FileInfo,
	type Result,
	type ShellExecOptions,
	type ShellExecResult,
	type TextLine,
	type TextLineReader,
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
		command: string,
		options: ShellExecOptions | undefined,
		context: Context,
	): Promise<Result<ShellExecResult, ExecutionError>> {
		const signal = context.abortSignal;
		// A function, not a captured boolean: the signal is live, and a check made before the
		// command started says nothing about the state when it finished.
		const aborted = (): boolean => signal?.aborted === true;
		if (aborted()) return err(new ExecutionError("aborted", "aborted"));
		const cwd = options?.cwd === undefined ? this.cwd : resolvePath(this.cwd, options.cwd);

		// The harness gives up on a command whose output callback throws, so the command has to
		// be stopped: an abandoned command would keep running inside the sandbox with nobody
		// reading it. Aborting our own controller is what reaches the engine's kill.
		const stop = new AbortController();
		let callbackError: ExecutionError | undefined;

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

		const decoder = new TextDecoder();
		const result = await this.sandbox
			.exec(command, {
				cwd,
				...(options?.env === undefined ? {} : { env: options.env }),
				...(options?.inheritEnv === false ? { clearEnv: true } : {}),
				...(options?.timeout === undefined ? {} : { timeoutMs: options.timeout }),
				signal: stop.signal,
				onChunk: (chunk) => {
					const piece = decoder.decode(chunk.data, { stream: true });
					if (piece === "") return;
					seen += piece;
					bytes += byteLength(piece);
					newlines += countNewlines(piece);
					// The file is opened lazily: a command that stays small never touches the
					// sandbox's disk, and what came before the threshold goes in first.
					const crossing =
						spill !== undefined && opening === undefined && (bytes >= spill.afterBytes || newlines >= spill.afterLines);
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
						options.onOutput(piece, context);
					} catch (error) {
						callbackError = new ExecutionError("callback_error", message(error));
						stop.abort();
					}
				},
			})
			.catch((error: unknown): ExecResult | Error => asError(error));

		// Anything decoded after the last chunk, plus the spill file's tail.
		const tail = decoder.decode();
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
		if (result instanceof Error) return err(new ExecutionError("spawn_error", message(result), result));
		if (callbackError !== undefined) return err(callbackError);
		if (result.stopped === "aborted") return err(new ExecutionError("aborted", "aborted"));
		// The caller's signal can fire after the command finished; that is not an abort.
		if (result.code !== 0 && aborted()) return err(new ExecutionError("aborted", "aborted"));
		if (result.stopped === "timeout") {
			const timeout = new ExecutionError("timeout", `Command timed out after ${options?.timeout ?? 0}ms`);
			if (spillPath !== undefined) timeout.spillPath = spillPath;
			return err(timeout);
		}
		return ok({ exitCode: result.code, ...(spillPath === undefined ? {} : { spillPath }) });
	}

	/** Open the spill file in the sandbox and put what happened before the threshold in it. */
	private async openSpill(prefix: string): Promise<{ path: string; sink: Awaited<ReturnType<SandboxClient["writeStream"]>> | undefined }> {
		const scratch = await this.sandbox.exec("mktemp /tmp/acornfall-output.XXXXXX", {}).catch(() => null);
		if (scratch === null || scratch.code !== 0) return { path: "", sink: undefined };
		const path = text(scratch.stdout).trim();
		const sink = await this.sandbox.writeStream(path).catch(() => null);
		if (sink === null) return { path, sink: undefined };
		await sink.write(prefix).catch(() => {});
		return { path, sink };
	}

	// -- files ------------------------------------------------------------------------

	async readTextFile(path: string, _context: Context): Promise<Result<string, FileError>> {
		const contents = await this.sandbox.read(path);
		if (contents === null) return err(new FileError("not_found", `No such file or directory: ${path}`, path));
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

	async openTextLineReader(path: string, context: Context): Promise<Result<TextLineReader, FileError>> {
		const contents = await this.readTextFile(path, context);
		if (!contents.ok) return contents;
		const lines = contents.value.split("\n");
		if (lines.at(-1) === "") lines.pop();
		let index = 0;
		return ok({
			readLine: async (_context: Context): Promise<Result<TextLine | undefined, FileError>> => {
				if (index >= lines.length) return ok(undefined);
				const text = lines[index] ?? "";
				index += 1;
				return ok({ text, terminated: true });
			},
			close: async (_context: Context): Promise<void> => {},
		});
	}

	async writeFile(path: string, content: string | Uint8Array, _context: Context): Promise<Result<void, FileError>> {
		return this.attempt(path, async () => {
			await this.sandbox.write(path, content);
		});
	}

	async appendFile(path: string, content: string | Uint8Array, _context: Context): Promise<Result<void, FileError>> {
		return this.attempt(path, async () => {
			// The engine writes and truncates; there is no append. So the file has to come back
			// through this process to be extended, which is the cost of not having one.
			const existing = await this.sandbox.readBytes(path).catch(() => new Uint8Array());
			const suffix = typeof content === "string" ? Buffer.from(content, "utf8") : content;
			await this.sandbox.write(path, Buffer.concat([Buffer.from(existing), Buffer.from(suffix)]));
		});
	}

	async truncateFile(path: string, size: number, _context: Context): Promise<Result<void, FileError>> {
		const bytes = Math.max(0, Math.floor(size));
		const result = await this.sandbox
			.exec(`truncate -s ${bytes} -- ${quote(path)}`, {})
			.catch((error: unknown): ExecResult | Error => asError(error));
		if (result instanceof Error) return err(new FileError(codeFor(message(result)), message(result), path));
		if (result.code !== 0) return err(new FileError(codeFor(text(result.stderr)), text(result.stderr), path));
		return ok(undefined);
	}

	async flushFile(_path: string, _context: Context): Promise<Result<void, FileError>> {
		// Every write is complete when the engine returns, so there is no buffer of ours left.
		return ok(undefined);
	}

	async renameFile(sourcePath: string, destinationPath: string, _context: Context): Promise<Result<void, FileError>> {
		return this.attempt(sourcePath, async () => {
			await this.sandbox.rename(sourcePath, destinationPath);
		});
	}

	async fileInfo(path: string, _context: Context): Promise<Result<FileInfo, FileError>> {
		const info = await this.sandbox.stat(path);
		if (info === null) return err(new FileError("not_found", `No such file or directory: ${path}`, path));
		return ok({ name: baseName(path), path, kind: info.directory ? "directory" : "file", size: info.size, mtimeMs: info.mtimeMs });
	}

	async listDir(path: string, _context: Context): Promise<Result<FileInfo[], FileError>> {
		const info = await this.sandbox.stat(path);
		if (info === null) return err(new FileError("not_found", `No such directory: ${path}`, path));
		if (!info.directory) return err(new FileError("not_directory", `Not a directory: ${path}`, path));
		const entries = await this.sandbox.list(path);
		return ok(
			entries.map((entry) => ({
				name: entry.name,
				path: joinPaths([path, entry.name]),
				kind: entry.directory ? ("directory" as const) : ("file" as const),
				size: entry.size,
				mtimeMs: entry.mtimeMs,
			})),
		);
	}

	async canonicalPath(path: string, _context: Context): Promise<Result<string, FileError>> {
		// Resolution happens inside the sandbox, where the file is: a host-side answer would be
		// about a path that does not exist there.
		const result = await this.sandbox.exec(`readlink -f -- ${quote(path)}`, {}).catch(() => null);
		if (result === null || result.code !== 0) return ok(resolvePath(this.cwd, path));
		const resolved = text(result.stdout).trim();
		return ok(resolved === "" ? resolvePath(this.cwd, path) : resolved);
	}

	async exists(path: string, _context: Context): Promise<Result<boolean, FileError>> {
		return ok((await this.sandbox.stat(path)) !== null);
	}

	async createDir(path: string, options: { recursive?: boolean } | undefined, _context: Context): Promise<Result<void, FileError>> {
		if (options?.recursive !== true) {
			const parent = dirName(path);
			if ((await this.sandbox.stat(parent)) === null) {
				return err(new FileError("not_found", `No such directory: ${parent}`, parent));
			}
		}
		return this.attempt(path, async () => {
			await this.sandbox.mkdir(path);
		});
	}

	async remove(
		path: string,
		options: { recursive?: boolean; force?: boolean } | undefined,
		_context: Context,
	): Promise<Result<void, FileError>> {
		const info = await this.sandbox.stat(path);
		if (info === null) {
			if (options?.force === true) return ok(undefined);
			return err(new FileError("not_found", `No such file or directory: ${path}`, path));
		}
		if (info.directory && options?.recursive !== true) {
			return err(new FileError("is_directory", `Is a directory: ${path}`, path));
		}
		return this.attempt(path, async () => {
			await this.sandbox.remove(path, { recursive: options?.recursive === true });
		});
	}

	async createTempDir(prefix: string | undefined, _context: Context): Promise<Result<string, FileError>> {
		return this.temp(prefix ?? "acornfall-dir", true);
	}

	async createTempFile(options: { prefix?: string; suffix?: string } | undefined, _context: Context): Promise<Result<string, FileError>> {
		return this.temp(options?.prefix ?? "acornfall-tmp", false);
	}

	private async temp(name: string, directory: boolean): Promise<Result<string, FileError>> {
		const template = `/tmp/${name}.XXXXXX`;
		const command = directory ? `mktemp -d ${quote(template)}` : `mktemp ${quote(template)}`;
		const result = await this.sandbox.exec(command, {}).catch((error: unknown): ExecResult | Error => asError(error));
		if (result instanceof Error) return err(new FileError("unknown", message(result), template));
		const path = text(result.stdout).trim();
		if (result.code !== 0 || path === "") {
			return err(new FileError("unknown", text(result.stderr) || "mktemp failed", template));
		}
		return ok(path);
	}

	// Temp files are the sandbox's own /tmp: they are already inside the boundary, and they
	// disappear when the sandbox's disk does. Nothing here has a buffer to release.
	async cleanup(_context: Context): Promise<void> {}

	/** Wrap a file operation the way the harness expects: failures returned, never thrown. */
	private async attempt<T>(path: string, operation: () => Promise<T>): Promise<Result<T, FileError>> {
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
	if (text.includes("no such file") || text.includes("not found") || text.includes("no such directory")) return "not_found";
	if (text.includes("permission") || text.includes("denied") || text.includes("read-only")) return "permission_denied";
	if (text.includes("is a directory")) return "is_directory";
	if (text.includes("not a directory")) return "not_directory";
	if (text.includes("not supported") || text.includes("unsupported")) return "not_supported";
	return "unknown";
}

/** Quote a path for the guest shell: single quotes, with the one escape that works. */
function quote(value: string): string {
	return `'${value.replaceAll("'", `'\\''`)}'`;
}
