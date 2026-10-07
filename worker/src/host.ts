import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { hostFiles, type DirEntry } from "./files.ts";
import {
	concatChunks,
	type ExecOptions,
	type ExecResult,
	type SandboxClient,
	type WriteSink,
} from "./sandbox.ts";

/**
 * The host engine: no sandbox. Commands run in the workspace with the user's own permissions
 * and reach, and file operations are the host's filesystem.
 *
 * It exists because the worker's only door to a workspace is its engine, so a machine without
 * a hypervisor has no workspace files at all — and because a development loop or a test suite
 * may want the workspace's features without paying for a microVM. Control selects it by name,
 * the state says it is not isolated, and choosing it is a decision somebody made: nothing here
 * is ever reached by a missing hypervisor. See docs/adr/0015-host-engine.md.
 */
export function engineName(): string {
	return "host";
}

export async function openSandbox(_name: string, workspace: string): Promise<SandboxClient> {
	return new HostClient(workspace);
}

class HostClient implements SandboxClient {
	/** The workspace, which is what this engine's "sandbox" is. */
	readonly name: string;
	private readonly workspace: string;

	constructor(workspace: string) {
		this.workspace = workspace;
		this.name = `host:${workspace}`;
	}

	async exec(command: string | readonly string[], options: ExecOptions): Promise<ExecResult> {
		// A string is a shell script; an array is the program and its arguments, unparsed.
		const argv = typeof command === "string" ? ["/bin/sh", "-c", command] : [...command];
		if (argv.length === 0) throw new Error("empty argv: no program to run");
		const proc = Bun.spawn(argv, {
			cwd: options.cwd ?? this.workspace,
			env:
				options.clearEnv === true ? { ...options.env } : { ...process.env, ...options.env },
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
			// Its own session, so the kill below can take the whole group. A shell that forked the
			// command would otherwise leave a grandchild holding the pipe, and the read would wait
			// for it even though the command was stopped.
			detached: true,
		});
		const stdout: Uint8Array[] = [];
		const stderr: Uint8Array[] = [];
		let stopped: "aborted" | "timeout" | undefined;
		const stop = (reason: "aborted" | "timeout"): void => {
			if (stopped !== undefined) return;
			stopped = reason;
			try {
				process.kill(-proc.pid, "SIGKILL");
			} catch {
				proc.kill("SIGKILL");
			}
		};
		const abort = (): void => stop("aborted");
		if (options.signal?.aborted === true) abort();
		else options.signal?.addEventListener("abort", abort, { once: true });
		let timer: ReturnType<typeof setTimeout> | undefined;
		if (options.timeoutMs !== undefined && options.timeoutMs > 0) {
			timer = setTimeout(() => stop("timeout"), options.timeoutMs);
		}
		const drain = async (
			stream: ReadableStream<Uint8Array>,
			chunks: Uint8Array[],
			kind: "stdout" | "stderr",
		): Promise<void> => {
			for await (const data of stream) {
				chunks.push(data);
				options.onChunk?.({ stream: kind, data });
			}
		};
		try {
			await Promise.all([
				drain(proc.stdout, stdout, "stdout"),
				drain(proc.stderr, stderr, "stderr"),
			]);
		} finally {
			if (timer !== undefined) clearTimeout(timer);
			options.signal?.removeEventListener("abort", abort);
		}
		const code = stopped === undefined ? await proc.exited : 143;
		return {
			code,
			stdout: concatChunks(stdout),
			stderr: concatChunks(stderr),
			...(stopped === undefined ? {} : { stopped }),
		};
	}

	// Reads and stats are the host's, exactly as the worker reads its own global resources:
	// there is no second filesystem to translate. The listing is its own because it carries
	// real sizes, which `hostFiles` leaves at zero.
	read(path: string): Promise<string | null> {
		return hostFiles.read(path);
	}

	async list(path: string): Promise<DirEntry[]> {
		const entries = await readdir(path, { withFileTypes: true }).catch(() => []);
		return await Promise.all(
			entries.map(async (entry) => {
				const info = await stat(join(path, entry.name)).catch(() => null);
				return {
					name: entry.name,
					directory: entry.isDirectory(),
					size: info?.size ?? 0,
					mtimeMs: info?.mtimeMs ?? 0,
				};
			}),
		);
	}

	stat(path: string): ReturnType<typeof hostFiles.stat> {
		return hostFiles.stat(path);
	}

	async readBytes(path: string): Promise<Uint8Array> {
		return new Uint8Array(await readFile(path));
	}

	async write(path: string, content: string | Uint8Array): Promise<void> {
		await writeFile(path, content);
	}

	async writeStream(path: string): Promise<WriteSink> {
		const writer = Bun.file(path).writer();
		return {
			write: async (data) => {
				await writer.write(data);
			},
			close: async () => {
				await writer.end();
			},
		};
	}

	async mkdir(path: string): Promise<void> {
		await mkdir(path, { recursive: true }).catch(() => {});
	}

	async remove(path: string, options: { recursive?: boolean; force?: boolean }): Promise<void> {
		await rm(path, {
			recursive: options.recursive === true,
			force: options.force === true,
		}).catch(() => {});
	}

	async rename(from: string, to: string): Promise<void> {
		await rename(from, to);
	}
}
