/**
 * The worker protocol, without a gateway in the way.
 *
 * This is the seam a second harness has to implement (docs/adr/0002), so it is tested as a
 * contract rather than through the layer above: JSONL on stdin, one object per line back,
 * commands answered by id, transcripts pushed as whole views, and a shutdown that ends the
 * process.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const workerDir = join(dirname(fileURLToPath(import.meta.url)), "..");

type Frame =
	| { type: "response"; id: string; ok: true; data?: unknown }
	| { type: "response"; id: string; ok: false; error: string }
	| { type: "view"; conversationId: string; seq: number; value: { entries: Entry[] } }
	| { type: "submission"; conversationId: string; submissionId: string; status: string }
	| { type: "auth"; authId: string; event: unknown };

interface Entry {
	id: number;
	kind: string;
	model: { role: string; content: unknown }[];
}

class Worker {
	#process: ReturnType<typeof Bun.spawn>;
	#stdin: { write(chunk: string): void };
	#frames: Frame[] = [];
	#waiters: { predicate: (frame: Frame) => boolean; resolve: (frame: Frame) => void }[] = [];
	#nextId = 0;

	constructor(directory: string, home: string, script: string) {
		this.#process = Bun.spawn(["bun", "run", "src/main.ts", "--workspace", directory, "--storage", join(home, "session.sqlite"), "--credentials", join(home, "credentials.json"), "--home", home, "--trusted", "true"], {
			cwd: workerDir,
			env: { ...process.env, ACORNFALL_DEV_SCRIPT: script },
			stdin: "pipe",
			stdout: "pipe",
			stderr: "inherit",
		});
		const stdin = this.#process.stdin;
		if (stdin === undefined || typeof stdin === "number") {
			throw new Error("the worker was started without a stdin pipe");
		}
		this.#stdin = stdin;
		void this.#read();
	}

	async #read(): Promise<void> {
		const decoder = new TextDecoder();
		let buffer = "";
		for await (const chunk of this.#process.stdout as ReadableStream<Uint8Array>) {
			buffer += decoder.decode(chunk, { stream: true });
			const lines = buffer.split("\n");
			buffer = lines.pop() ?? "";
			for (const line of lines) {
				if (line.trim() === "") continue;
				const frame = JSON.parse(line) as Frame;
				const waiter = this.#waiters.findIndex((candidate) => candidate.predicate(frame));
				if (waiter >= 0) {
					const [found] = this.#waiters.splice(waiter, 1);
					found?.resolve(frame);
				} else {
					this.#frames.push(frame);
				}
			}
		}
	}

	send(command: Record<string, unknown>): string {
		const id = `c${++this.#nextId}`;
		this.#stdin.write(`${JSON.stringify({ id, ...command })}\n`);
		return id;
	}

	/** The response to one command, by id. */
	async response<T = unknown>(id: string, timeout = 30_000): Promise<T> {
		const frame = await this.wait((candidate) => candidate.type === "response" && candidate.id === id, timeout);
		if (frame.type === "response" && !frame.ok) throw new Error(frame.error);
		return (frame as { data?: unknown }).data as T;
	}

	async call<T = unknown>(command: Record<string, unknown>, timeout = 30_000): Promise<T> {
		return this.response<T>(this.send(command), timeout);
	}

	async wait(predicate: (frame: Frame) => boolean, timeout = 30_000): Promise<Frame> {
		const existing = this.#frames.findIndex(predicate);
		if (existing >= 0) return this.#frames.splice(existing, 1)[0]!;
		return new Promise<Frame>((resolve, reject) => {
			const timer = setTimeout(() => reject(new Error("timed out waiting for a frame")), timeout);
			this.#waiters.push({
				predicate,
				resolve: (frame) => {
					clearTimeout(timer);
					resolve(frame);
				},
			});
		});
	}

	/** The transcript, waited for until it says what the test is about to assert. */
	async transcript(conversationId: string, until: string): Promise<string> {
		const frame = await this.wait(
			(candidate) =>
				candidate.type === "view" &&
				candidate.conversationId === conversationId &&
				JSON.stringify(candidate.value.entries).includes(until),
		);
		return (frame as { value: { entries: Entry[] } }).value.entries
			.map((entry) => JSON.stringify(entry.model))
			.join("\n");
	}

	kill(): void {
		this.#process.kill();
	}
}

let worker: Worker;
let home: string;

beforeAll(async () => {
	home = await mkdtemp(join(tmpdir(), "acornfall-protocol-"));
	const workspace = join(home, "workspace");
	await mkdir(workspace, { recursive: true });
	const script = join(home, "script.json");
	await writeFile(
		script,
		JSON.stringify({
			rules: [
				{ match: "hello", reply: "PROTOCOL MARKER" },
				{ match: "run it", tools: [{ name: "bash", args: { command: "echo ran" } }], reply: "did it" },
			],
		}),
	);
	worker = new Worker(workspace, home, script);
});

afterAll(() => worker?.kill());

describe("the worker protocol", () => {
	test("describes itself and its providers", async () => {
		const described = await worker.call<{
			provider: string;
			workdir: string;
			providers: { id: string; authenticated: boolean }[];
			capabilities: { steer: boolean };
		}>({ type: "describe" });

		expect(described.provider).toBe("pi-durable");
		expect(described.workdir.endsWith("workspace")).toBe(true);
		expect(described.providers.some((provider) => provider.id === "faux" && provider.authenticated)).toBe(true);
		expect(described.capabilities.steer).toBe(true);
	});

	test("creates, lists, opens, renames, and hides a conversation", async () => {
		const created = await worker.call<{ conversationId: string }>({ type: "create" });
		expect(created.conversationId).not.toBe("");

		const listed = await worker.call<{ conversations: { id: string; root: boolean; hidden: boolean }[] }>({
			type: "conversations",
		});
		const conversation = listed.conversations.find((candidate) => candidate.id === created.conversationId);
		expect(conversation).toBeDefined();
		expect(conversation?.root).toBe(false);

		// Configuration is applied per conversation, and the answer says what it resolved to.
		const opened = await worker.call<{ agent: { name: string }; model: unknown }>({
			type: "open",
			conversationId: created.conversationId,
			agent: { provider: "faux", modelId: "faux-1" },
		});
		expect(opened.model).toBeDefined();

		await worker.call({ type: "rename", conversationId: created.conversationId, title: "Renamed" });
		await worker.call({ type: "hide", conversationId: created.conversationId, hidden: true });
		const after = await worker.call<{ conversations: { id: string; title: string; hidden: boolean }[] }>({
			type: "conversations",
		});
		const renamed = after.conversations.find((candidate) => candidate.id === created.conversationId);
		expect(renamed?.title).toBe("Renamed");
		expect(renamed?.hidden).toBe(true);
	});

	test("a prompt runs tools, streams a view, and reports submissions", async () => {
		const created = await worker.call<{ conversationId: string }>({ type: "create" });
		await worker.call({
			type: "open",
			conversationId: created.conversationId,
			agent: { provider: "faux", modelId: "faux-1" },
		});
		await worker.call({ type: "attach", conversationId: created.conversationId });

		await worker.call({ type: "prompt", conversationId: created.conversationId, text: "run it" });
		const transcript = await worker.transcript(created.conversationId, "did it");
		expect(transcript).toContain("toolCall");
		expect(transcript).toContain("ran");
		expect(transcript).toContain("did it");

		const submission = await worker.wait(
			(frame) => frame.type === "submission" && frame.conversationId === created.conversationId,
		);
		expect(submission.type).toBe("submission");
	});

	test("expand rewrites a command into what the model will see", async () => {
		const workspace = join(home, "workspace");
		await mkdir(join(workspace, ".acornfall", "commands"), { recursive: true });
		await writeFile(
			join(workspace, ".acornfall", "commands", "protocol.md"),
			"---\nname: protocol-command\ndescription: for the test\n---\nIt says $ARGUMENTS.",
		);
		await worker.call({ type: "reload" });

		const expanded = await worker.call<{ text: string; command?: string }>({
			type: "expand",
			text: "/protocol-command hello there",
		});
		expect(expanded.text).toBe("It says hello there.");
		expect(expanded.command).toBe("protocol-command");

		// Anything that is not a command comes back untouched.
		const plain = await worker.call<{ text: string }>({ type: "expand", text: "just a message" });
		expect(plain.text).toBe("just a message");
	});

	test("a command that does not exist is left as the message it is", async () => {
		const expanded = await worker.call<{ text: string }>({ type: "expand", text: "/not-a-command at all" });
		expect(expanded.text).toBe("/not-a-command at all");
	});

	test("reports policies, usage, commands, and agents", async () => {
		const created = await worker.call<{ conversationId: string }>({ type: "create" });
		const policy = await worker.call<{ canSpawn: boolean; delegation: { maxWakes: number } }>({
			type: "policy",
			conversationId: created.conversationId,
		});
		expect(policy.canSpawn).toBe(true);
		expect(policy.delegation.maxWakes).toBeGreaterThan(0);

		const usage = await worker.call<unknown>({ type: "usage" });
		expect(usage).toBeDefined();

		const commands = await worker.call<{ commands: { name: string }[] }>({ type: "commands" });
		expect(commands.commands.some((command) => command.name === "protocol-command")).toBe(true);

		const agents = await worker.call<{ agents: unknown[]; defaults: unknown[] }>({ type: "agents" });
		expect(Array.isArray(agents.agents)).toBe(true);
	});

	test("an unknown command fails as a response, and does not end the stream", async () => {
		const id = worker.send({ type: "not-a-command" });
		await expect(worker.response(id)).rejects.toThrow();
		// Still alive afterwards.
		const described = await worker.call<{ provider: string }>({ type: "describe" });
		expect(described.provider).toBe("pi-durable");
	});
});
