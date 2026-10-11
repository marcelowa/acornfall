import { expect, test } from "bun:test";
import { SandboxNotRunningError, SandboxReplacedError } from "microsandbox";
import {
	ENGINE_VERSION,
	MicrosandboxClient,
	checkEngineVersion,
	isStoppedError,
	type MicrosandboxHandle,
	type MicrosandboxSession,
} from "../src/microsandbox.ts";

/**
 * Wake-on-demand: the engine stops idle sandboxes on its own (30m) while the gateway
 * keeps a watched workspace's worker alive past that, so a worker whose session died
 * under it is the normal state after half an hour of quiet. The client wakes the
 * sandbox and retries once; a stopped sandbox is never reported as missing files
 * (issue #58). The fakes below stand in for the SDK's handle and session, which the
 * unit tier cannot boot — the real boot-and-wake runs in `sandbox.integration.test.ts`.
 */

function stoppedError(): Error {
	return new SandboxNotRunningError(
		'sandbox "acornfall-fake-0000" has no agent endpoint (is it running?)',
	);
}

function missingFileError(operation: string): Error {
	return new Error(`sandbox fs error: ${operation}: No such file or directory (os error 2)`);
}

interface FakeFs {
	readToString(path: string): Promise<string>;
	read(path: string): Promise<Uint8Array>;
	write(path: string, content: string | Uint8Array): Promise<void>;
	writeStream(
		path: string,
	): Promise<{ write: (data: unknown) => Promise<void>; close: () => Promise<void> }>;
	list(path: string): Promise<{ path: string; kind: string; size: number; modified?: Date }[]>;
	stat(path: string): Promise<{ kind: string; size: number; modified?: Date }>;
	mkdir(path: string): Promise<void>;
	remove(path: string): Promise<void>;
	removeDir(path: string): Promise<void>;
	rename(from: string, to: string): Promise<void>;
}

type ExecStreamWith = (
	program: string,
	configure: (builder: unknown) => unknown,
) => Promise<{ kill: () => Promise<void>; [Symbol.asyncIterator]: () => AsyncIterator<unknown> }>;

function fakeSession(fs: FakeFs, execStreamWith?: ExecStreamWith): MicrosandboxSession {
	return {
		execStreamWith:
			execStreamWith ??
			(() => {
				throw new Error("not used by these tests");
			}),
		fs: () => fs,
	} as unknown as MicrosandboxSession;
}

/** An exec handle yielding canned events, with a kill that records it was called. */
function fakeExecHandle(events: { kind: string; code?: number; data?: Uint8Array }[]): {
	handle: { kill: () => Promise<void>; [Symbol.asyncIterator]: () => AsyncIterator<unknown> };
	killed: () => boolean;
} {
	let killed = false;
	const handle = {
		kill: async () => {
			killed = true;
		},
		async *[Symbol.asyncIterator]() {
			for (const event of events) yield event;
		},
	};
	return { handle, killed: () => killed };
}

/** A session whose every call fails with the stopped error: a dead VM behind a live worker. */
function deadFs(): FakeFs {
	const dead = async (): Promise<never> => {
		throw stoppedError();
	};
	return {
		readToString: dead,
		read: dead,
		write: dead,
		writeStream: dead,
		list: dead,
		stat: dead,
		mkdir: dead,
		remove: dead,
		removeDir: dead,
		rename: dead,
	};
}

function liveFs(files: Map<string, string>): FakeFs {
	return {
		readToString: async (path) => {
			const found = files.get(path);
			if (found === undefined) throw missingFileError("open");
			return found;
		},
		read: async (path) => {
			const found = files.get(path);
			if (found === undefined) throw missingFileError("open");
			return new TextEncoder().encode(found);
		},
		write: async (path, content) => {
			files.set(
				path,
				typeof content === "string" ? content : new TextDecoder().decode(content),
			);
		},
		writeStream: async (path) => {
			files.set(path, "");
			return {
				write: async (data: unknown) => {
					files.set(path, (files.get(path) ?? "") + String(data));
				},
				close: async () => {},
			};
		},
		list: async (path) => {
			const entries: { path: string; kind: string; size: number }[] = [];
			const prefix = path.endsWith("/") ? path : `${path}/`;
			for (const [file, contents] of files) {
				if (!file.startsWith(prefix)) continue;
				const rest = file.slice(prefix.length);
				if (rest.includes("/")) continue;
				entries.push({ path: file, kind: "file", size: contents.length });
			}
			return entries;
		},
		stat: async (path) => {
			const found = files.get(path);
			if (found === undefined) throw missingFileError("stat");
			return { kind: "file", size: found.length };
		},
		mkdir: async () => {},
		remove: async (path) => {
			files.delete(path);
		},
		removeDir: async (path) => {
			files.delete(path);
		},
		rename: async (from, to) => {
			const found = files.get(from);
			if (found === undefined) throw missingFileError("rename");
			files.set(to, found);
			files.delete(from);
		},
	};
}

/** A handle whose wake boots exactly one session, counting how many boots it ran. */
function fakeHandle(woken: MicrosandboxSession): {
	handle: MicrosandboxHandle;
	boots: () => number;
} {
	let boots = 0;
	const handle = {
		connectOrStart: async () => {
			boots += 1;
			return woken;
		},
	} as unknown as MicrosandboxHandle;
	return { handle, boots: () => boots };
}

test("a stopped sandbox wakes on read and the file is read, not reported missing", async () => {
	const files = new Map([["/work/notes.txt", "hello\n"]]);
	const { handle, boots } = fakeHandle(fakeSession(liveFs(files)));
	const client = new MicrosandboxClient("acornfall-fake-0000", handle, fakeSession(deadFs()));
	expect(await client.read("/work/notes.txt")).toBe("hello\n");
	expect(boots()).toBe(1);
});

test("a stopped sandbox wakes on write and the write lands", async () => {
	const files = new Map<string, string>();
	const { handle, boots } = fakeHandle(fakeSession(liveFs(files)));
	const client = new MicrosandboxClient("acornfall-fake-0000", handle, fakeSession(deadFs()));
	await client.write("/work/new.txt", "written\n");
	expect(files.get("/work/new.txt")).toBe("written\n");
	expect(boots()).toBe(1);
});

test("a stopped sandbox wakes on exec and the command runs once", async () => {
	const { handle: wokenHandle } = fakeExecHandle([
		{ kind: "stdout", data: new TextEncoder().encode("awake") },
		{ kind: "exited", code: 0 },
	]);
	let acquisitions = 0;
	const woken = fakeSession(liveFs(new Map()), async () => {
		acquisitions += 1;
		return wokenHandle;
	});
	const { handle, boots } = fakeHandle(woken);
	const deadExec: ExecStreamWith = async () => {
		throw stoppedError();
	};
	const client = new MicrosandboxClient(
		"acornfall-fake-0000",
		handle,
		fakeSession(deadFs(), deadExec),
	);
	const result = await client.exec("/bin/echo awake", {});
	expect(result.code).toBe(0);
	expect(new TextDecoder().decode(result.stdout)).toBe("awake");
	expect(boots()).toBe(1);
	// Only the acquisition retries: a command that started is never run twice.
	expect(acquisitions).toBe(1);
});

test("parallel tool calls join one wake, not one boot each", async () => {
	const files = new Map([
		["/work/a.txt", "a\n"],
		["/work/b.txt", "b\n"],
		["/work/c.txt", "c\n"],
	]);
	let boots = 0;
	let resolveWake: ((session: MicrosandboxSession) => void) | undefined;
	const woken = fakeSession(liveFs(files));
	const handle = {
		connectOrStart: () =>
			new Promise<MicrosandboxSession>((resolve) => {
				boots += 1;
				resolveWake = resolve;
			}),
	} as unknown as MicrosandboxHandle;
	const client = new MicrosandboxClient("acornfall-fake-0000", handle, fakeSession(deadFs()));
	const pending = Promise.all([
		client.read("/work/a.txt"),
		client.read("/work/b.txt"),
		client.read("/work/c.txt"),
	]);
	await Bun.sleep(10);
	// All three found the dead session while the wake is still in flight.
	expect(boots).toBe(1);
	resolveWake?.(woken);
	expect(await pending).toEqual(["a\n", "b\n", "c\n"]);
	expect(boots).toBe(1);
});

test("a genuine missing file is still null, without waking", async () => {
	const { handle, boots } = fakeHandle(fakeSession(liveFs(new Map())));
	const client = new MicrosandboxClient(
		"acornfall-fake-0000",
		handle,
		fakeSession(liveFs(new Map())),
	);
	expect(await client.read("/work/nope.txt")).toBeNull();
	expect(await client.stat("/work/nope.txt")).toBeNull();
	expect(await client.list("/work/nope")).toEqual([]);
	expect(boots()).toBe(0);
});

test("a same-name replacement is never woken: no retry on a different machine", async () => {
	// Reads keep their contract — anything that is not a stopped sandbox still answers
	// null, which resource loading depends on — but the call must never wake and retry
	// against a different machine behind the same name.
	const replaced = async (): Promise<never> => {
		throw new SandboxReplacedError('sandbox "acornfall-fake-0000" was replaced');
	};
	const replacingFs: FakeFs = {
		...liveFs(new Map()),
		readToString: replaced,
	};
	let boots = 0;
	const handle = {
		connectOrStart: async (): Promise<MicrosandboxSession> => {
			boots += 1;
			return fakeSession(liveFs(new Map()));
		},
	} as unknown as MicrosandboxHandle;
	const client = new MicrosandboxClient("acornfall-fake-0000", handle, fakeSession(replacingFs));
	expect(await client.read("/work/notes.txt")).toBeNull();
	expect(boots).toBe(0);
	// A throwing operation surfaces the replacement instead of waking.
	const replacingWriteFs: FakeFs = {
		...liveFs(new Map()),
		write: replaced,
	};
	const writer = new MicrosandboxClient(
		"acornfall-fake-0000",
		handle,
		fakeSession(replacingWriteFs),
	);
	expect(writer.write("/work/notes.txt", "x")).rejects.toThrow(/replaced/);
	expect(boots).toBe(0);
});

test("a failed wake reports the wake's error", async () => {
	const handle = {
		connectOrStart: async (): Promise<MicrosandboxSession> => {
			throw new Error("engine unavailable");
		},
	} as unknown as MicrosandboxHandle;
	const client = new MicrosandboxClient("acornfall-fake-0000", handle, fakeSession(deadFs()));
	expect(client.read("/work/notes.txt")).rejects.toThrow(/engine unavailable/);
});

test("a loaded SDK that is not the pinned engine refuses before touching the store", async () => {
	// The pin's value is checked against the gateway's by scripts/check-house-rules.mjs:
	// the two share the store, so one value in two languages must stay one value.
	await checkEngineVersion(async () => ({ version: ENGINE_VERSION }));
	expect(checkEngineVersion(async () => ({ version: "0.7.7" }))).rejects.toThrow(/want 0\.7\.6/);
	expect(checkEngineVersion(async () => ({}))).rejects.toThrow(/want 0\.7\.6/);
	expect(
		checkEngineVersion(async () => {
			throw new Error("unreadable");
		}),
	).rejects.toThrow(/want 0\.7\.6/);
});

test("isStoppedError tells a dead session from a missing file", () => {
	expect(isStoppedError(stoppedError())).toBe(true);
	expect(isStoppedError({ code: "sandboxNotRunning", message: "stopped" })).toBe(true);
	expect(isStoppedError(new Error('sandbox "x" has no agent endpoint (is it running?)'))).toBe(
		true,
	);
	expect(isStoppedError(missingFileError("stat"))).toBe(false);
	expect(isStoppedError(new SandboxReplacedError('sandbox "x" was replaced'))).toBe(false);
	expect(isStoppedError(new Error("boom"))).toBe(false);
});
