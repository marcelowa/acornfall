import { describe, expect, it } from "bun:test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { registerEnvConformance } from "@earendil-works/pi-durable/testing";
import { openSandbox } from "../src/host.ts";
import { SandboxExecutionEnv } from "../src/sandbox-env.ts";

/**
 * The environment over the host engine, checked against the harness's own conformance suite.
 *
 * `ExecutionEnv` is the seam every tool reads and writes through, and it grows: 1.0.3 added
 * readers, pagers, watchers, and argv exec. The suite is the contract's own idea of what
 * those mean; this is what says the worker's implementation kept up. The host engine needs
 * no hypervisor, so the check runs without one — a fresh empty directory per case, as the
 * provider contract asks.
 */
registerEnvConformance(
	{ describe, expect, it },
	"SandboxExecutionEnv (host engine) conformance",
	async (use) => {
		const dir = await realpath(await mkdtemp(join(tmpdir(), "acornfall-envconf-")));
		const sandbox = await openSandbox("conformance", dir);
		try {
			await use(new SandboxExecutionEnv(sandbox, dir));
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	},
	{ shell: ["sh", "-c"] },
);
