import { expect, test } from "bun:test";
import { Sandbox } from "microsandbox";
import { openSandbox } from "../src/microsandbox.ts";

/**
 * The real engine, through the real SDK: streaming execution, killing a running command, and
 * the file operations. The unit suite covers the same contract against a fake, which cannot
 * prove that the SDK's stream arrives before exit, that a kill stops the guest process, or
 * that the filesystem calls map to what the engine does.
 *
 * Bun has no -short, so the gate is an environment variable and `make test-sandbox` is its
 * only caller. `make test` must stay the same on every machine, and a machine without a
 * hypervisor has no business booting one.
 */
const enabled = process.env.ACORNFALL_SANDBOX_INTEGRATION === "1";
const integration = enabled ? test : test.skip;

integration(
	"streams, kills, and reads and writes files through the real engine",
	async () => {
		const name = `acornfall-integration-${process.pid}-${Date.now()}`;
		const created = await Sandbox.builder(name)
			.image("debian:stable-slim")
			.cpus(1)
			.memory(512)
			.idleTimeout(60)
			.create();
		try {
			const client = await openSandbox(name, "/");

			// A chunk has to arrive while the command is still running; one blob at exit would
			// pass a concatenation check while being exactly the bug the streaming path exists
			// to avoid.
			const chunks: string[] = [];
			const streamed = await client.exec("printf one; sleep 0.3; printf two", {
				onChunk: (chunk) => {
					chunks.push(new TextDecoder().decode(chunk.data));
				},
			});
			expect(streamed.code).toBe(0);
			expect(chunks.join("")).toBe("onetwo");
			expect(chunks.length).toBeGreaterThan(1);

			// An argv runs its program directly, so the shell never parses an argument's text.
			const argv = await client.exec(["printf", "%s|%s", "a b", "it's"], {});
			expect(new TextDecoder().decode(argv.stdout)).toBe("a b|it's");
			expect(client.exec(["definitely-not-a-real-program-xyz"], {})).rejects.toThrow();

			// Clearing the environment keeps the variables the caller named, in both forms, and
			// a `;` in a script does not split the clearing in half.
			const clearedArgv = await client.exec(["printenv", "FOO"], {
				clearEnv: true,
				env: { FOO: "bar" },
			});
			expect(new TextDecoder().decode(clearedArgv.stdout)).toBe("bar\n");
			const clearedScript = await client.exec("printenv FOO; printf two", {
				clearEnv: true,
				env: { FOO: "bar" },
			});
			expect(new TextDecoder().decode(clearedScript.stdout)).toBe("bar\ntwo");

			// Killing is inside the sandbox: a command stopped from here must not run its tail
			// afterwards, which is what a host-side kill leaves behind.
			await client.mkdir("/tmp/acornfall-integration");
			const marker = "/tmp/acornfall-integration/killed";
			const controller = new AbortController();
			const longRunning = client.exec(`sleep 3 && touch ${marker}`, {
				signal: controller.signal,
			});
			await new Promise((resolve) => setTimeout(resolve, 300));
			controller.abort();
			const aborted = await longRunning;
			expect(aborted.stopped).toBe("aborted");
			await new Promise((resolve) => setTimeout(resolve, 3500));
			expect(await client.stat(marker)).toBeNull();

			// The file operations, each read back through a second call so a write cannot pass
			// on a return value alone.
			const hello = "/tmp/acornfall-integration/hello.txt";
			await client.write(hello, "from the test\n");
			expect(await client.read(hello)).toBe("from the test\n");
			expect(new TextDecoder().decode(await client.readBytes(hello))).toBe("from the test\n");

			const streamedPath = "/tmp/acornfall-integration/streamed.txt";
			const sink = await client.writeStream(streamedPath);
			await sink.write("one ");
			await sink.write("two\n");
			await sink.close();
			expect(await client.read(streamedPath)).toBe("one two\n");

			const entries = await client.list("/tmp/acornfall-integration");
			expect(entries.map((entry) => entry.name).sort()).toEqual([
				"hello.txt",
				"streamed.txt",
			]);
			const helloEntry = entries.find((entry) => entry.name === "hello.txt");
			expect(helloEntry?.directory).toBe(false);
			expect(helloEntry?.size).toBe("from the test\n".length);
			const info = await client.stat(hello);
			expect(info?.directory).toBe(false);
			expect(info?.size).toBe("from the test\n".length);

			await client.rename(hello, "/tmp/acornfall-integration/renamed.txt");
			expect(await client.read(hello)).toBeNull();
			expect(await client.read("/tmp/acornfall-integration/renamed.txt")).toBe(
				"from the test\n",
			);
			await client.remove("/tmp/acornfall-integration/renamed.txt", {});
			expect(await client.read("/tmp/acornfall-integration/renamed.txt")).toBeNull();
		} finally {
			// Exactly the sandbox this test made: the state directory is shared, and deleting
			// anything else there would be the isolation bug in another suite.
			await created.stop().catch(() => {});
			await Sandbox.remove(name).catch(() => {});
		}
	},
	120_000,
);
