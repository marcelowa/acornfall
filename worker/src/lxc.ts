import { mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import type { DirEntry } from "./files.ts";
import {
	concatChunks,
	type ExecOptions,
	type ExecResult,
	type SandboxClient,
	type WriteSink,
} from "./sandbox.ts";

/**
 * The container engine, from inside the machine: a workspace is an LXC container, and the
 * worker is in the machine that holds it (ADR 0022). Nothing here crosses a wire — the worker
 * runs `lxc-attach` and reads the container's own filesystem, because both are local.
 *
 * This is the pair of gateway/internal/sandbox's InMachine engine: control makes and starts the
 * container, the worker runs things in it. The name is the one control sends (`lxc`), so the two
 * sides of one install cannot disagree about which engine is in use.
 */
export function engineName(): string {
	return "lxc";
}

/** Where the machine keeps the containers it makes, which is the runtime's own layout. */
const containerDir = "/var/lib/lxc";

export async function openSandbox(name: string, workspace: string): Promise<SandboxClient> {
	const client = new LXCClient(name, workspace);
	// A container that was made and not started is the ordinary state after a machine boots:
	// starting it is what this engine's first use means.
	await client.ensureRunning();
	return client;
}

/** One container's filesystem, as the machine sees it. */
export function rootfsOf(name: string): string {
	return join(containerDir, name, "rootfs");
}

/**
 * Where a path inside the container lives on the machine. A workspace is mounted into the
 * container at its own path, so its files are the machine's own; everything else is inside the
 * container's rootfs, which is a folder in the machine.
 */
export function machinePath(rootfs: string, workspace: string, path: string): string {
	const clean = path.startsWith("/") ? path : `/${path}`;
	if (clean === workspace || clean.startsWith(`${workspace}/`)) return clean;
	return join(rootfs, clean);
}

class LXCClient implements SandboxClient {
	readonly name: string;
	private readonly workspace: string;
	private readonly rootfs: string;

	constructor(name: string, workspace: string) {
		this.name = name;
		this.workspace = workspace;
		this.rootfs = rootfsOf(name);
	}

	/** The container's state in the runtime's own words, or "" when there is no such container. */
	private async state(): Promise<string> {
		const proc = Bun.spawn(["lxc-info", "-n", this.name, "-s"], {
			stdout: "pipe",
			stderr: "pipe",
		});
		const [out] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
		return out.trim().split(":").at(-1)?.trim() ?? "";
	}

	/**
	 * Starts the container when it is not running. A container that does not exist is not
	 * started here: control makes containers, and inventing one would be this side deciding
	 * what a workspace is.
	 */
	async ensureRunning(): Promise<void> {
		if ((await this.state()) === "RUNNING") return;
		const proc = Bun.spawn(["lxc-start", "-n", this.name], { stdout: "pipe", stderr: "pipe" });
		const [err, code] = await Promise.all([new Response(proc.stderr).text(), proc.exited]);
		if (code !== 0) {
			throw new Error(`lxc-start ${this.name}: ${err.trim() || `exit ${code}`}`);
		}
	}

	async exec(command: string | readonly string[], options: ExecOptions): Promise<ExecResult> {
		const inner = typeof command === "string" ? ["/bin/sh", "-c", command] : [...command];
		if (inner.length === 0) throw new Error("empty argv: no program to run");
		// A working directory and a chosen environment both have to be applied inside the
		// container, so the command runs under a shell there; the argv travels as positional
		// parameters, so nothing in it is parsed twice.
		const argv =
			options.cwd === undefined && options.clearEnv !== true && options.env === undefined
				? inner
				: ["/bin/sh", "-c", this.wrapper(options), "sh", ...inner];
		const proc = Bun.spawn(["lxc-attach", "-n", this.name, "--", ...argv], {
			stdin: "ignore",
			stdout: "pipe",
			stderr: "pipe",
			// Its own process group, so the kill below takes the command inside the container with
			// it: killing the attach alone leaves it running (measured, docs/engineering/container-shim.md).
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

	/** The shell that applies the working directory and the environment, then execs the command. */
	private wrapper(options: ExecOptions): string {
		const parts: string[] = [];
		if (options.cwd !== undefined) parts.push(`cd "$1" && shift`);
		if (options.clearEnv === true) parts.push("exec env -i " + this.envArgs(options) + ' "$@"');
		else if (options.env !== undefined && Object.keys(options.env).length > 0) {
			parts.push(`exec env ${this.envArgs(options)} "$@"`);
		} else parts.push('exec "$@"');
		return parts.join(" && ");
	}

	private envArgs(options: ExecOptions): string {
		return Object.entries(options.env ?? {})
			.map(([key, value]) => `${key}=${shellQuote(value)}`)
			.join(" ");
	}

	// Reads, listings and writes are the machine's filesystem: a workspace is mounted into the
	// container at its own path, so its files are the machine's own, and everything else is
	// under the container's rootfs.
	private path(path: string): string {
		return machinePath(this.rootfs, this.workspace, path);
	}

	async read(path: string): Promise<string | null> {
		return await readFile(this.path(path), "utf8").catch(() => null);
	}

	async list(path: string): Promise<DirEntry[]> {
		const entries = await readdir(this.path(path), { withFileTypes: true }).catch(() => []);
		return await Promise.all(
			entries.map(async (entry) => {
				const info = await stat(join(this.path(path), entry.name)).catch(() => null);
				return {
					name: entry.name,
					directory: entry.isDirectory(),
					size: info?.size ?? 0,
					mtimeMs: info?.mtimeMs ?? 0,
				};
			}),
		);
	}

	async stat(
		path: string,
	): Promise<{ directory: boolean; size: number; mtimeMs: number } | null> {
		const info = await stat(this.path(path)).catch(() => null);
		if (info === null) return null;
		return { directory: info.isDirectory(), size: info.size, mtimeMs: info.mtimeMs };
	}

	async readBytes(path: string): Promise<Uint8Array> {
		return new Uint8Array(await readFile(this.path(path)));
	}

	async write(path: string, content: string | Uint8Array): Promise<void> {
		const target = this.path(path);
		await mkdir(dirname(target), { recursive: true }).catch(() => {});
		await writeFile(target, content);
	}

	async writeStream(path: string): Promise<WriteSink> {
		const target = this.path(path);
		await mkdir(dirname(target), { recursive: true }).catch(() => {});
		const writer = Bun.file(target).writer();
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
		await mkdir(this.path(path), { recursive: true }).catch(() => {});
	}

	async remove(path: string, options: { recursive?: boolean; force?: boolean }): Promise<void> {
		await rm(this.path(path), {
			recursive: options.recursive === true,
			force: options.force === true,
		}).catch(() => {});
	}

	async rename(from: string, to: string): Promise<void> {
		await rename(this.path(from), this.path(to));
	}
}

/** A value that survives one trip through a shell. */
function shellQuote(value: string): string {
	return `'${value.replaceAll("'", "'\\''")}'`;
}
