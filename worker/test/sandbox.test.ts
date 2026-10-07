import { expect, test } from "bun:test";
import { BACKGROUND_CONTEXT } from "@earendil-works/chord/context";
import { hostFiles, routingFiles, type Files } from "../src/files.ts";
import { SandboxExecutionEnv } from "../src/sandbox-env.ts";
import {
	refusedSandbox,
	type DirEntry,
	type ExecOptions,
	type ExecResult,
	type SandboxClient,
	type WriteSink,
} from "../src/sandbox.ts";

const CONTEXT = BACKGROUND_CONTEXT;

/** An in-memory sandbox: the engine contract without a hypervisor. */
class FakeSandbox implements SandboxClient {
	readonly name = "acornfall-fake-0000";
	files = new Map<string, Uint8Array>();
	directories = new Set<string>(["/"]);
	execs: { command: string | readonly string[]; options: ExecOptions }[] = [];
	renameCalls: { from: string; to: string }[] = [];
	/** Chunks a command produces, keyed by nothing: whatever `exec` is called with next. */
	respond = (command: string): { code: number; stdout?: string; stderr?: string } => {
		if (command.startsWith("mktemp")) return { code: 0, stdout: "/tmp/acornfall-tmp.a1b2c3\n" };
		if (command.startsWith("readlink")) return { code: 1 };
		if (command.startsWith("truncate")) return { code: 0 };
		return { code: 0 };
	};
	/** What a command streams before it exits, for the streaming and spill tests. */
	stream: string[] = [];

	async exec(command: string | readonly string[], options: ExecOptions): Promise<ExecResult> {
		this.execs.push({ command, options });
		for (const piece of this.stream)
			options.onChunk?.({ stream: "stdout", data: new TextEncoder().encode(piece) });
		const result = this.respond(typeof command === "string" ? command : command.join(" "));
		return {
			code: result.code,
			stdout: new TextEncoder().encode(result.stdout ?? ""),
			stderr: new TextEncoder().encode(result.stderr ?? ""),
		};
	}

	async read(path: string): Promise<string | null> {
		const bytes = this.files.get(path);
		return bytes === undefined ? null : new TextDecoder().decode(bytes);
	}

	async readBytes(path: string): Promise<Uint8Array> {
		const bytes = this.files.get(path);
		if (bytes === undefined) throw new Error(`cat: ${path}: No such file or directory`);
		return bytes;
	}

	async write(path: string, content: string | Uint8Array): Promise<void> {
		this.put(path, content);
	}

	async writeStream(path: string): Promise<WriteSink> {
		this.put(path, "");
		return {
			write: async (data) => {
				const existing = this.files.get(path) ?? new Uint8Array();
				this.put(path, Buffer.concat([Buffer.from(existing), Buffer.from(data as string)]));
			},
			close: async () => {},
		};
	}

	async list(path: string): Promise<DirEntry[]> {
		const prefix = path.endsWith("/") ? path : `${path}/`;
		const entries = new Map<string, DirEntry>();
		for (const file of this.files.keys()) {
			if (!file.startsWith(prefix)) continue;
			const rest = file.slice(prefix.length);
			const name = rest.split("/")[0] ?? "";
			const directory = rest.includes("/") || this.directories.has(`${prefix}${name}`);
			if (name !== "") entries.set(name, { name, directory, size: 0, mtimeMs: 0 });
		}
		return [...entries.values()];
	}

	async stat(
		path: string,
	): Promise<{ directory: boolean; size: number; mtimeMs: number } | null> {
		if (this.directories.has(path)) return { directory: true, size: 0, mtimeMs: 1 };
		const bytes = this.files.get(path);
		if (bytes !== undefined) return { directory: false, size: bytes.byteLength, mtimeMs: 1 };
		// A path something else lives under behaves like a directory, as it would on a disk.
		const prefix = path.endsWith("/") ? path : `${path}/`;
		for (const file of this.files.keys()) {
			if (file.startsWith(prefix)) return { directory: true, size: 0, mtimeMs: 1 };
		}
		return null;
	}

	async mkdir(path: string): Promise<void> {
		this.directories.add(path);
	}

	async remove(path: string, _options: { recursive?: boolean; force?: boolean }): Promise<void> {
		this.files.delete(path);
		this.directories.delete(path);
	}

	async rename(from: string, to: string): Promise<void> {
		this.renameCalls.push({ from, to });
		const bytes = this.files.get(from);
		if (bytes === undefined) throw new Error(`mv: ${from}: No such file or directory`);
		this.put(to, bytes);
		this.files.delete(from);
	}

	private put(path: string, content: string | Uint8Array): void {
		this.files.set(
			path,
			typeof content === "string" ? new TextEncoder().encode(content) : content,
		);
	}
}

function environment(): { sandbox: FakeSandbox; env: SandboxExecutionEnv } {
	const sandbox = new FakeSandbox();
	return { sandbox, env: new SandboxExecutionEnv(sandbox, "/work") };
}

// -- routing: one door to the workspace ----------------------------------------------

test("reads under the workspace go to the sandbox and reads elsewhere do not", async () => {
	const sandbox = new FakeSandbox();
	const files = routingFiles("/work", sandbox);
	await sandbox.write("/work/AGENTS.md", "from the sandbox");
	await sandbox.write("/work/.agents/config.json", "{}");

	expect(await files.read("/work/AGENTS.md")).toBe("from the sandbox");
	expect(await files.read("/work/.agents/config.json")).toBe("{}");

	// A folder that merely starts with the workspace's name is not inside it.
	expect(await files.read("/work-other/AGENTS.md")).toBeNull();
	// The user's own folders are on the host, and the sandbox is never asked for them.
	expect(await sandbox.read("/home/user/.agents/config.json")).toBeNull();
	let asked = false;
	const watched: Files = {
		read: async (path) => {
			asked = true;
			return sandbox.read(path);
		},
		list: (path) => sandbox.list(path),
		stat: (path) => sandbox.stat(path),
	};
	await routingFiles("/work", watched).read("/home/user/.agents/AGENTS.md");
	expect(asked).toBe(false);
});

test("the host filesystem answers for everything outside the workspace", async () => {
	const root = await Bun.$`mktemp -d`.text();
	const directory = root.trim();
	await Bun.write(`${directory}/outside.txt`, "on the host");
	const files = routingFiles("/work", new FakeSandbox());
	expect(await files.read(`${directory}/outside.txt`)).toBe("on the host");
	expect(await files.read(`${directory}/missing.txt`)).toBeNull();
	expect(await files.stat(directory).then((info) => info?.directory)).toBe(true);
	expect(
		await files.list(directory).then((entries) => entries.map((entry) => entry.name)),
	).toEqual(["outside.txt"]);
});

// -- the refusal ---------------------------------------------------------------------

test("a missing sandbox reads nothing and refuses everything else", async () => {
	const sandbox = refusedSandbox("this workspace has no sandbox: tool execution is disabled");
	expect(await sandbox.read("/work/AGENTS.md")).toBeNull();
	expect(await sandbox.list("/work")).toEqual([]);
	expect(await sandbox.stat("/work")).toBeNull();
	// The host is not a fallback: the refusal is what the tool result will say.
	expect(() => sandbox.exec("ls", {})).toThrow(/no sandbox/);
	const refused = await sandbox.write("/work/file", "x").then(
		() => "it wrote to a workspace with no sandbox",
		(error: unknown) => (error instanceof Error ? error.message : String(error)),
	);
	expect(refused).toContain("no sandbox");
});

// -- running commands ----------------------------------------------------------------

test("a command streams its output as it arrives and reports the exit code", async () => {
	const { sandbox, env } = environment();
	sandbox.stream = ["first\n", "second\n"];
	const chunks: string[] = [];
	const result = await env.exec(
		"sh -c 'echo'",
		{ onOutput: (text) => chunks.push(text) },
		CONTEXT,
	);
	expect(result.ok).toBe(true);
	expect(result.ok && result.value.exitCode).toBe(0);
	expect(chunks.join("")).toBe("first\nsecond\n");
	expect(sandbox.execs[0]?.command).toBe("sh -c 'echo'");
});

test("the working directory and environment a tool asks for reach the engine", async () => {
	const { sandbox, env } = environment();
	await env.exec("pwd", { cwd: "sub", env: { FOO: "bar" } }, CONTEXT);
	await env.exec("pwd", { inheritEnv: false, env: { ONLY: "this" } }, CONTEXT);
	expect(sandbox.execs[0]?.options.cwd).toBe("/work/sub");
	expect(sandbox.execs[0]?.options.env).toEqual({ FOO: "bar" });
	expect(sandbox.execs[0]?.options.clearEnv).toBeUndefined();
	expect(sandbox.execs[1]?.options.clearEnv).toBe(true);
});

test("a command that exits non-zero is a result, not an error", async () => {
	const { sandbox, env } = environment();
	sandbox.respond = () => ({ code: 3, stderr: "no such file\n" });
	const result = await env.exec("cat missing", {}, CONTEXT);
	expect(result.ok).toBe(true);
	expect(result.ok && result.value.exitCode).toBe(3);
});

test("aborting a command reports it as aborted and stops it", async () => {
	const { sandbox, env } = environment();
	const controller = new AbortController();
	sandbox.respond = () => ({ code: 143 });
	sandbox.exec = async (
		command: string | readonly string[],
		options: ExecOptions,
	): Promise<ExecResult> => {
		sandbox.execs.push({ command, options });
		controller.abort();
		return {
			code: 143,
			stdout: new Uint8Array(),
			stderr: new Uint8Array(),
			stopped: "aborted",
		};
	};
	const result = await env.exec("sleep 100", {}, { ...CONTEXT, abortSignal: controller.signal });
	expect(result.ok).toBe(false);
	expect(!result.ok && result.error.code).toBe("aborted");
});

test("a command that runs too long reports a timeout and carries its spilt output", async () => {
	const { sandbox, env } = environment();
	sandbox.stream = ["x".repeat(64)];
	sandbox.exec = async (
		command: string | readonly string[],
		options: ExecOptions,
	): Promise<ExecResult> => {
		sandbox.execs.push({ command, options });
		if (
			typeof command === "string" &&
			(command.startsWith("mktemp") || command.startsWith("truncate"))
		) {
			const answer = sandbox.respond(command);
			return {
				code: answer.code,
				stdout: new TextEncoder().encode(answer.stdout ?? ""),
				stderr: new Uint8Array(),
			};
		}
		for (const piece of sandbox.stream)
			options.onChunk?.({ stream: "stdout", data: new TextEncoder().encode(piece) });
		return {
			code: 143,
			stdout: new Uint8Array(),
			stderr: new Uint8Array(),
			stopped: "timeout",
		};
	};
	const result = await env.exec(
		"sleep 100",
		{ timeout: 5, spill: { afterBytes: 16, afterLines: 1000 } },
		CONTEXT,
	);
	expect(result.ok).toBe(false);
	if (result.ok) return;
	expect(result.error.code).toBe("timeout");
	// The output that did happen is still reachable, which is what the spill file is for.
	expect(result.error.spillPath).toBe("/tmp/acornfall-tmp.a1b2c3");
	expect(await sandbox.read("/tmp/acornfall-tmp.a1b2c3")).toBe("x".repeat(64));
});

test("output that crosses the spill thresholds is written to a file, and small output is not", async () => {
	const { sandbox, env } = environment();
	sandbox.stream = ["line\n".repeat(10)];
	const spilled = await env.exec("big", { spill: { afterBytes: 8, afterLines: 1000 } }, CONTEXT);
	expect(spilled.ok && spilled.value.spillPath).toBe("/tmp/acornfall-tmp.a1b2c3");
	expect(await sandbox.read("/tmp/acornfall-tmp.a1b2c3")).toBe("line\n".repeat(10));

	const small = environment();
	small.sandbox.stream = ["one line\n"];
	const notSpilled = await small.env.exec(
		"small",
		{ spill: { afterBytes: 1024, afterLines: 100 } },
		CONTEXT,
	);
	expect(notSpilled.ok && notSpilled.value.spillPath).toBeUndefined();
	expect(
		small.sandbox.execs.every(
			(call) => typeof call.command !== "string" || !call.command.startsWith("mktemp"),
		),
	).toBe(true);
});

test("a sandbox that cannot run the command is a spawn error, not a silent success", async () => {
	const { env } = environment();
	const broken = new SandboxExecutionEnv(
		{
			...refusedSandbox("the sandbox is gone"),
			exec: async () => {
				throw new Error("the sandbox is gone");
			},
		},
		"/work",
	);
	// The same environment, over a client that throws: a command that cannot start is a spawn
	// error rather than a silent success.
	expect((await env.exec("true", {}, CONTEXT)).ok).toBe(true);
	const result = await broken.exec("true", {}, CONTEXT);
	expect(result.ok).toBe(false);
	expect(!result.ok && result.error.code).toBe("spawn_error");
	expect(!result.ok && result.error.message).toContain("the sandbox is gone");
});

// -- files ---------------------------------------------------------------------------

test("the environment's id is the sandbox, so two calls see the same files", () => {
	const sandbox = new FakeSandbox();
	expect(new SandboxExecutionEnv(sandbox, "/work").id).toBe(`sandbox:${sandbox.name}`);
	expect(new SandboxExecutionEnv(sandbox, "/elsewhere").id).toBe(`sandbox:${sandbox.name}`);
});

test("paths resolve against the working directory the way a shell would", async () => {
	const { env } = environment();
	expect(
		(await env.absolutePath("sub/file.txt", CONTEXT)).ok &&
			(await env.absolutePath("sub/file.txt", CONTEXT)),
	).toMatchObject({
		value: "/work/sub/file.txt",
	});
	expect(await env.absolutePath("../other", CONTEXT).then((r) => r.ok && r.value)).toBe("/other");
	expect(await env.absolutePath("/absolute", CONTEXT).then((r) => r.ok && r.value)).toBe(
		"/absolute",
	);
	// Joining is string work and does not make a path absolute, as it does not anywhere else.
	expect(await env.joinPath(["a", "b", "c"], CONTEXT).then((r) => r.ok && r.value)).toBe("a/b/c");
});

test("a missing file is not_found and a present one is its contents", async () => {
	const { sandbox, env } = environment();
	const missing = await env.readTextFile("/work/nope.txt", CONTEXT);
	expect(missing.ok).toBe(false);
	expect(!missing.ok && missing.error.code).toBe("not_found");
	await sandbox.write("/work/here.txt", "hello");
	expect(await env.readTextFile("/work/here.txt", CONTEXT).then((r) => r.ok && r.value)).toBe(
		"hello",
	);
	expect(await env.exists("/work/here.txt", CONTEXT).then((r) => r.ok && r.value)).toBe(true);
	expect(await env.exists("/work/nope.txt", CONTEXT).then((r) => r.ok && r.value)).toBe(false);
});

test("a write, an append, a rename, and a remove all happen in the sandbox", async () => {
	const { sandbox, env } = environment();
	expect((await env.writeFile("/work/one.txt", "first", CONTEXT)).ok).toBe(true);
	expect((await env.appendFile("/work/one.txt", "-more", CONTEXT)).ok).toBe(true);
	expect(await sandbox.read("/work/one.txt")).toBe("first-more");
	expect((await env.renameFile("/work/one.txt", "/work/two.txt", CONTEXT)).ok).toBe(true);
	expect(await sandbox.read("/work/two.txt")).toBe("first-more");
	expect((await env.remove("/work/two.txt", undefined, CONTEXT)).ok).toBe(true);
	expect(await sandbox.read("/work/two.txt")).toBeNull();
});

test("removing refuses a directory unless recursion was asked for", async () => {
	const { sandbox, env } = environment();
	await sandbox.mkdir("/work/dir");
	const result = await env.remove("/work/dir", undefined, CONTEXT);
	expect(!result.ok && result.error.code).toBe("is_directory");
	expect((await env.remove("/work/dir", { recursive: true }, CONTEXT)).ok).toBe(true);
});

test("listing reports what the sandbox has, including whether each entry is a directory", async () => {
	const { sandbox, env } = environment();
	await sandbox.write("/work/a.txt", "a");
	await sandbox.write("/work/nested/b.txt", "b");
	const listed = await env.listDir("/work", CONTEXT);
	expect(listed.ok).toBe(true);
	if (!listed.ok) return;
	const byName = Object.fromEntries(listed.value.map((entry) => [entry.name, entry.kind]));
	expect(byName).toEqual({ "a.txt": "file", nested: "directory" });
	const missing = await env.listDir("/work/nope", CONTEXT);
	expect(!missing.ok && missing.error.code).toBe("not_found");
});

test("a file's info comes from the sandbox, and a missing one is not_found", async () => {
	const { sandbox, env } = environment();
	await sandbox.write("/work/sized.txt", "12345");
	const info = await env.fileInfo("/work/sized.txt", CONTEXT);
	expect(info.ok && info.value.size).toBe(5);
	expect(info.ok && info.value.name).toBe("sized.txt");
	const missing = await env.fileInfo("/work/nope", CONTEXT);
	expect(!missing.ok && missing.error.code).toBe("not_found");
});

test("creating a directory without recursion needs its parent to exist", async () => {
	const { sandbox, env } = environment();
	expect(sandbox.directories.has("/work")).toBe(false);
	const orphan = await env.createDir("/work/new", undefined, CONTEXT);
	expect(!orphan.ok && orphan.error.code).toBe("not_found");
	expect((await env.createDir("/work/a/b", { recursive: true }, CONTEXT)).ok).toBe(true);
});

test("temporary files are created inside the sandbox", async () => {
	const { sandbox, env } = environment();
	const file = await env.createTempFile({ prefix: "acornfall" }, CONTEXT);
	expect(file.ok && file.value).toBe("/tmp/acornfall-tmp.a1b2c3");
	const directory = await env.createTempDir("acornfall", CONTEXT);
	expect(directory.ok && directory.value).toBe("/tmp/acornfall-tmp.a1b2c3");
	// The template is quoted: a temporary directory is still a path in a shell command.
	expect(sandbox.execs[0]?.command).toContain("mktemp '/tmp/acornfall.XXXXXX'");
	expect(sandbox.execs[1]?.command).toContain("mktemp -d '/tmp/acornfall.XXXXXX'");
});

test("line readers hand back one line at a time and stop at the end", async () => {
	const { sandbox, env } = environment();
	await sandbox.write("/work/lines.txt", "one\ntwo\nthree\n");
	const reader = await env.openTextLineReader("/work/lines.txt", CONTEXT);
	expect(reader.ok).toBe(true);
	if (!reader.ok) return;
	const lines: (string | undefined)[] = [];
	for (let index = 0; index < 4; index += 1) {
		const line = await reader.value.readLine(CONTEXT);
		lines.push(line.ok ? line.value?.text : undefined);
	}
	expect(lines).toEqual(["one", "two", "three", undefined]);
	expect(
		await env.readTextLines("/work/lines.txt", undefined, CONTEXT).then((r) => r.ok && r.value),
	).toEqual(["one", "two", "three"]);
	expect(
		await env
			.readTextLines("/work/lines.txt", { maxLines: 2 }, CONTEXT)
			.then((r) => r.ok && r.value),
	).toEqual(["one", "two"]);
});

test("the host filesystem is not reachable through the environment's own helpers", async () => {
	// The environment is the sandbox, so even a path that exists on this machine does not
	// exist here: that is the whole point of the boundary.
	const { env } = environment();
	const onThisMachine = await hostFiles.read("/etc/hostname");
	expect(onThisMachine).not.toBeNull();
	expect(await env.exists("/etc/hostname", CONTEXT).then((r) => r.ok && r.value)).toBe(false);
});
