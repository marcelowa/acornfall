/**
 * The worker protocol, without a gateway in the way.
 *
 * This is the seam a second harness has to implement (docs/adr/0002), so it is tested as a
 * contract rather than through the layer above: JSONL on stdin, one object per line back,
 * commands answered by id, transcripts pushed as whole views, and a shutdown that ends the
 * process.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanupScratch, tempDir } from "./scratch.ts";

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
		this.#process = Bun.spawn(
			[
				"bun",
				"run",
				"src/main.ts",
				"--workspace",
				directory,
				"--storage",
				join(home, "session.sqlite"),
				"--credentials",
				join(home, "credentials.json"),
				"--home",
				home,
			],
			{
				cwd: workerDir,
				env: { ...process.env, ACORNFALL_DEV_SCRIPT: script },
				stdin: "pipe",
				stdout: "pipe",
				stderr: "inherit",
			},
		);
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
		const frame = await this.wait(
			(candidate) => candidate.type === "response" && candidate.id === id,
			timeout,
		);
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
			const timer = setTimeout(
				() => reject(new Error("timed out waiting for a frame")),
				timeout,
			);
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
	home = await tempDir("acornfall-protocol-");
	const workspace = join(home, "workspace");
	await mkdir(workspace, { recursive: true });
	const script = join(home, "script.json");
	await writeFile(
		script,
		JSON.stringify({
			rules: [
				{ match: "hello", reply: "PROTOCOL MARKER" },
				{
					match: "run it",
					tools: [{ name: "bash", args: { command: "echo ran" } }],
					reply: "did it",
				},
			],
		}),
	);
	worker = new Worker(workspace, home, script);
});

afterAll(async () => {
	worker?.kill();
	await cleanupScratch();
});

describe("the worker protocol", () => {
	test("describes itself and its providers", async () => {
		const described = await worker.call<{
			provider: string;
			workdir: string;
			providers: { id: string; authenticated: boolean; authTypes: unknown[] }[];
			capabilities: { steer: boolean };
		}>({ type: "describe" });

		expect(described.provider).toBe("pi-durable");
		expect(described.workdir.endsWith("workspace")).toBe(true);
		expect(
			described.providers.some(
				(provider) => provider.id === "faux" && provider.authenticated,
			),
		).toBe(true);
		expect(described.capabilities.steer).toBe(true);
		// The connect dialog offers only methods the provider implements:
		// every entry says which, and ambient-only says none.
		for (const provider of described.providers) {
			expect(Array.isArray(provider.authTypes)).toBe(true);
		}
	});

	test("creates, lists, opens, renames, and hides a conversation", async () => {
		const created = await worker.call<{ conversationId: string }>({ type: "create" });
		expect(created.conversationId).not.toBe("");

		const listed = await worker.call<{
			conversations: { id: string; root: boolean; hidden: boolean; updatedAt?: number }[];
		}>({
			type: "conversations",
		});
		const conversation = listed.conversations.find(
			(candidate) => candidate.id === created.conversationId,
		);
		expect(conversation).toBeDefined();
		expect(conversation?.root).toBe(false);
		// A conversation that has not moved carries no activity, so the rail renders it flat.
		expect(conversation?.updatedAt).toBeUndefined();

		// Configuration is applied per conversation, and the answer says what it resolved to.
		const opened = await worker.call<{ agent: { name: string }; model: unknown }>({
			type: "open",
			conversationId: created.conversationId,
			agent: { provider: "faux", modelId: "faux-1" },
		});
		expect(opened.model).toBeDefined();

		await worker.call({
			type: "rename",
			conversationId: created.conversationId,
			title: "Renamed",
		});
		await worker.call({ type: "hide", conversationId: created.conversationId, hidden: true });
		const after = await worker.call<{
			conversations: { id: string; title: string; hidden: boolean }[];
		}>({
			type: "conversations",
		});
		const renamed = after.conversations.find(
			(candidate) => candidate.id === created.conversationId,
		);
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

		await worker.call({
			type: "prompt",
			conversationId: created.conversationId,
			text: "run it",
		});
		const transcript = await worker.transcript(created.conversationId, "did it");
		expect(transcript).toContain("toolCall");
		expect(transcript).toContain("ran");
		expect(transcript).toContain("did it");

		const submission = await worker.wait(
			(frame) =>
				frame.type === "submission" && frame.conversationId === created.conversationId,
		);
		expect(submission.type).toBe("submission");

		// The listing carries last activity, so the rail can group by date. The entry is fresh,
		// so its timestamp is recent Unix milliseconds.
		const listed = await worker.call<{
			conversations: { id: string; updatedAt?: number }[];
		}>({ type: "conversations" });
		const moved = listed.conversations.find(
			(candidate) => candidate.id === created.conversationId,
		);
		expect(moved?.updatedAt).toBeGreaterThan(Date.now() - 60_000);
	});

	test("expand rewrites a command into what the model will see", async () => {
		// The install's own commands folder, not the workspace's: this worker runs without a
		// sandbox, so the workspace has no readable files at all — which is the point of the
		// refusal, and is asserted in sandbox.test.ts.
		await mkdir(join(home, "commands"), { recursive: true });
		await writeFile(
			join(home, "commands", "protocol.md"),
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
		const plain = await worker.call<{ text: string }>({
			type: "expand",
			text: "just a message",
		});
		expect(plain.text).toBe("just a message");
	});

	test("a command that does not exist is left as the message it is", async () => {
		const expanded = await worker.call<{ text: string }>({
			type: "expand",
			text: "/not-a-command at all",
		});
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

		const agents = await worker.call<{ agents: unknown[]; defaults: unknown[] }>({
			type: "agents",
		});
		expect(Array.isArray(agents.agents)).toBe(true);
	});

	test("an unknown command fails as a response, and does not end the stream", async () => {
		const id = worker.send({ type: "not-a-command" });
		expect(worker.response(id)).rejects.toThrow();
		// Still alive afterwards.
		const described = await worker.call<{ provider: string }>({ type: "describe" });
		expect(described.provider).toBe("pi-durable");
	});

	test("a login waiting for an answer does not hold up the queue", async () => {
		// A dialog nobody answers leaves the flow waiting for a prompt that never comes. The
		// queue must not wait with it: the state, the conversations, and the next message all
		// queue behind the login otherwise, and the console looks dead until the provider's own
		// timeout ends the flow.
		const id = worker.send({
			type: "login",
			authId: "auth-queue",
			providerId: "anthropic",
			authType: "api_key",
		});
		const frame = await worker.wait(
			(candidate) =>
				candidate.type === "auth" &&
				(candidate as { authId?: string }).authId === "auth-queue",
		);
		const prompt = (frame as { event: { kind: string; promptId: string } }).event;
		expect(prompt.kind).toBe("prompt");

		// The queue is free while the login waits.
		const described = await worker.call<{ provider: string }>({ type: "describe" }, 5_000);
		expect(described.provider).toBe("pi-durable");

		// The answer bypasses the queue, and the login settles with its own response.
		await worker.call({
			type: "auth_answer",
			authId: "auth-queue",
			promptId: prompt.promptId,
			value: "sk-test",
		});
		const login = await worker.response<{ providerId: string }>(id, 5_000);
		expect(login.providerId).toBe("anthropic");
	});

	test("a sign-in that identifies the install is not refused for want of an id", async () => {
		// OpenAI's ChatGPT sign-in sends the install id as the agent host id, and refuses to
		// start when it has none — the failure this guards. The flow's own callback port is
		// fixed (1455), so it may end with "port in use" when a Codex CLI or another sign-in
		// holds it; the id is read before that, which is what this asks about.
		const id = worker.send({
			type: "login",
			authId: "auth-host-id",
			providerId: "openai",
			authType: "oauth",
		});
		const frame = await worker.wait(
			(candidate) =>
				candidate.type === "auth" &&
				["auth_url", "error"].includes(
					(candidate as { event?: { kind?: string } }).event?.kind ?? "",
				),
		);
		const event = (frame as { event: { kind: string; url?: string; message?: string } }).event;
		if (event.kind === "auth_url") {
			const url = new URL(event.url ?? "");
			expect(url.searchParams.get("ext_agent_host_id")).toMatch(/^urn:uuid:[0-9a-f-]{36}$/);
		} else {
			expect(event.message ?? "").not.toContain("device ID");
		}
		// The flow ends as cancelled, which is also what frees the fixed port.
		await worker.call({ type: "auth_cancel", authId: "auth-host-id" });
		await worker.response(id).catch(() => undefined);
	});
});
