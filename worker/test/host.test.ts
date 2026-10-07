import { expect, test } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openSandbox } from "../src/host.ts";
import type { SandboxClient } from "../src/sandbox.ts";

/**
 * The host engine through its own client, with no fake and no hypervisor. The engine is the
 * one a machine without KVM can still run a workspace on, so its exec, kill, and file
 * operations are covered like the microVM engine's are — the difference is that this suite
 * runs in the fast tier, and the microVM one needs /dev/kvm.
 */
async function open(): Promise<{ dir: string; client: SandboxClient; done: () => Promise<void> }> {
	const dir = await realpath(await mkdtemp(join(tmpdir(), "acornfall-host-")));
	const client = await openSandbox("unused", dir);
	return { dir, client, done: () => rm(dir, { recursive: true, force: true }) };
}

test("a command streams as it runs and reports its exit code", async () => {
	const { client, done } = await open();
	try {
		const chunks: string[] = [];
		const result = await client.exec("printf one; sleep 0.2; printf two", {
			onChunk: (chunk) => chunks.push(new TextDecoder().decode(chunk.data)),
		});
		expect(result.code).toBe(0);
		expect(result.stopped).toBeUndefined();
		expect(new TextDecoder().decode(result.stdout)).toBe("onetwo");
		expect(chunks.length).toBeGreaterThan(1);

		const failed = await client.exec("printf bad >&2; exit 3", {});
		expect(failed.code).toBe(3);
		expect(new TextDecoder().decode(failed.stderr)).toBe("bad");
	} finally {
		await done();
	}
});

test("a command runs in the workspace, or where it was told to", async () => {
	const { dir, client, done } = await open();
	try {
		const here = await client.exec("pwd", {});
		expect(new TextDecoder().decode(here.stdout).trim()).toBe(dir);
		await client.mkdir(join(dir, "sub"));
		const there = await client.exec("pwd", { cwd: join(dir, "sub") });
		expect(new TextDecoder().decode(there.stdout).trim()).toBe(join(dir, "sub"));
	} finally {
		await done();
	}
});

test("the environment is the host's, or exactly what the caller gives", async () => {
	const { client, done } = await open();
	try {
		const prefix = process.env.PATH ?? "";
		expect(prefix).not.toBe("");
		const inherited = await client.exec("printf %s \"$PATH\"", {});
		expect(new TextDecoder().decode(inherited.stdout)).toBe(prefix);

		const given = await client.exec("printf %s \"$FOO\"", { env: { FOO: "bar" } });
		expect(new TextDecoder().decode(given.stdout)).toBe("bar");

		// clearEnv means the guest's own environment, not "add nothing": a command that relies
		// on the host's PATH or HOME must not see it.
		const cleared = await client.exec("printf %s \"$HOME\"", { clearEnv: true });
		expect(new TextDecoder().decode(cleared.stdout)).toBe("");
	} finally {
		await done();
	}
});

test("a timeout and an abort stop the command and say which happened", async () => {
	const { client, done } = await open();
	try {
		const started = Date.now();
		const timedOut = await client.exec("sleep 5", { timeoutMs: 100 });
		expect(timedOut.stopped).toBe("timeout");
		expect(timedOut.code).toBe(143);
		expect(Date.now() - started).toBeLessThan(2000);

		const controller = new AbortController();
		const timer = setTimeout(() => controller.abort(), 50);
		const aborted = await client.exec("sleep 5", { signal: controller.signal });
		clearTimeout(timer);
		expect(aborted.stopped).toBe("aborted");
		expect(aborted.code).toBe(143);
	} finally {
		await done();
	}
});

test("files are read, written, streamed, listed, moved, and removed", async () => {
	const { dir, client, done } = await open();
	try {
		const hello = join(dir, "hello.txt");
		await client.write(hello, "from the test\n");
		expect(await client.read(hello)).toBe("from the test\n");
		expect(new TextDecoder().decode(await client.readBytes(hello))).toBe("from the test\n");

		const streamed = join(dir, "streamed.txt");
		const sink = await client.writeStream(streamed);
		await sink.write("one ");
		await sink.write("two\n");
		await sink.close();
		expect(await client.read(streamed)).toBe("one two\n");

		const entries = await client.list(dir);
		expect(entries.map((entry) => entry.name).sort()).toEqual(["hello.txt", "streamed.txt"]);
		const listed = entries.find((entry) => entry.name === "hello.txt");
		expect(listed?.directory).toBe(false);
		expect(listed?.size).toBe("from the test\n".length);
		const info = await client.stat(hello);
		expect(info?.directory).toBe(false);
		expect(info?.size).toBe("from the test\n".length);
		expect(await client.stat(dir)).toMatchObject({ directory: true });

		await client.rename(hello, join(dir, "renamed.txt"));
		expect(await client.read(hello)).toBeNull();
		expect(await client.read(join(dir, "renamed.txt"))).toBe("from the test\n");

		await client.mkdir(join(dir, "nested/deep"));
		expect(await client.stat(join(dir, "nested/deep"))).toMatchObject({ directory: true });
		await client.remove(join(dir, "nested"), { recursive: true });
		expect(await client.stat(join(dir, "nested"))).toBeNull();

		// A missing file is a null read, not an error; readBytes is the one that insists.
		expect(await client.read(join(dir, "missing"))).toBeNull();
		expect(await client.stat(join(dir, "missing"))).toBeNull();
		expect(client.readBytes(join(dir, "missing"))).rejects.toThrow();
	} finally {
		await done();
	}
});
