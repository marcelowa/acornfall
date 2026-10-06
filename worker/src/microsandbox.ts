import { Sandbox } from "microsandbox";
import { concatChunks, type DirEntry, type ExecOptions, type ExecResult, type SandboxClient, type WriteSink } from "./sandbox.ts";

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

export async function openSandbox(name: string): Promise<SandboxClient> {
	const handle = await Sandbox.get(name);
	return new MicrosandboxClient(name, await handle.connect());
}

/** The attached session: the SDK's type, named once so the rest of the class can use it. */
type Session = Awaited<ReturnType<Awaited<ReturnType<typeof Sandbox.get>>["connect"]>>;

class MicrosandboxClient implements SandboxClient {
	readonly name: string;
	private readonly session: Session;

	constructor(name: string, session: Session) {
		this.name = name;
		this.session = session;
	}

	async exec(command: string, options: ExecOptions): Promise<ExecResult> {
		const handle = await this.session.execStreamWith("/bin/sh", (builder) => {
			let configured = builder.arg("-c").arg(options.clearEnv === true ? `env -i ${command}` : command);
			if (options.cwd !== undefined) configured = configured.cwd(options.cwd);
			for (const [key, value] of Object.entries(options.env ?? {})) configured = configured.env(key, value);
			return configured;
		});
		const stdout: Uint8Array[] = [];
		const stderr: Uint8Array[] = [];
		let stopped: "aborted" | "timeout" | undefined;
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
				if (event.kind !== "stdout" && event.kind !== "stderr") continue;
				(event.kind === "stdout" ? stdout : stderr).push(event.data);
				options.onChunk?.({ stream: event.kind, data: event.data });
			}
		} finally {
			if (timer !== undefined) clearTimeout(timer);
			options.signal?.removeEventListener("abort", abort);
		}
		const code = stopped === undefined ? (await handle.wait()).code : 143;
		return { code, stdout: concatChunks(stdout), stderr: concatChunks(stderr), ...(stopped === undefined ? {} : { stopped }) };
	}

	async read(path: string): Promise<string | null> {
		return await this.session
			.fs()
			.readToString(path)
			.catch(() => null);
	}

	async readBytes(path: string): Promise<Uint8Array> {
		return await this.session.fs().read(path);
	}

	async write(path: string, content: string | Uint8Array): Promise<void> {
		await this.session.fs().write(path, content);
	}

	async writeStream(path: string): Promise<WriteSink> {
		const sink = await this.session.fs().writeStream(path);
		return { write: (data) => sink.write(data), close: () => sink.close() };
	}

	async list(path: string): Promise<DirEntry[]> {
		const entries = await this.session
			.fs()
			.list(path)
			.catch(() => []);
		return entries.map((entry) => ({
			name: baseName(entry.path),
			directory: entry.kind === "directory",
			size: entry.size,
			mtimeMs: entry.modified?.getTime() ?? 0,
		}));
	}

	async stat(path: string): Promise<{ directory: boolean; size: number; mtimeMs: number } | null> {
		const info = await this.session
			.fs()
			.stat(path)
			.catch(() => null);
		if (info === null) return null;
		return { directory: info.kind === "directory", size: info.size, mtimeMs: info.modified?.getTime() ?? 0 };
	}

	async mkdir(path: string): Promise<void> {
		await this.session
			.fs()
			.mkdir(path)
			.catch(() => {});
	}

	async remove(path: string, options: { recursive?: boolean; force?: boolean }): Promise<void> {
		const fs = this.session.fs();
		await (options.recursive === true ? fs.removeDir(path) : fs.remove(path)).catch(() => {});
	}

	async rename(from: string, to: string): Promise<void> {
		await this.session.fs().rename(from, to);
	}
}

function baseName(path: string): string {
	const trimmed = path.endsWith("/") ? path.slice(0, -1) : path;
	const index = trimmed.lastIndexOf("/");
	return index < 0 ? trimmed : trimmed.slice(index + 1);
}
