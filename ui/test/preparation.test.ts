import { describe, expect, test } from "bun:test";
import { watchWorkspacePreparation } from "../src/app/preparation";
import type { WireLifecycle } from "../src/app/wire";

const state = (phase: string, workerUp = false) => ({
	workerUp,
	lifecycle: { phase } as WireLifecycle,
});

describe("preparing a new workspace", () => {
	test("waits for the harness and then says it is ready", async () => {
		const answers = [state("starting"), state("starting"), state("ready", true)];
		let calls = 0;
		const result = await watchWorkspacePreparation("new-one", {
			fetch: async () => answers[calls++] ?? state("ready", true),
			isCurrent: () => true,
			sleep: async () => undefined,
		});
		expect(calls).toBe(3);
		expect(result).toEqual({ phase: "ready" });
	});

	test("reports the gateway's reason when the harness fails", async () => {
		const result = await watchWorkspacePreparation("new-one", {
			fetch: async () => ({
				workerUp: false,
				lifecycle: { phase: "failed", reason: "exit status 1" },
			}),
			isCurrent: () => true,
			sleep: async () => undefined,
		});
		expect(result).toEqual({ phase: "failed", reason: "exit status 1" });
	});

	test("a fetch that fails once is retried, not shown as the workspace failing", async () => {
		let calls = 0;
		const result = await watchWorkspacePreparation("new-one", {
			fetch: async () => {
				calls += 1;
				if (calls === 1) throw new Error("Failed to fetch");
				return state("ready", true);
			},
			isCurrent: () => true,
			sleep: async () => undefined,
		});
		expect(calls).toBe(2);
		expect(result).toEqual({ phase: "ready" });
	});

	test("a workspace that is dismissed stops being asked about", async () => {
		let calls = 0;
		let current = true;
		const result = await watchWorkspacePreparation("new-one", {
			fetch: async () => {
				calls += 1;
				current = false;
				return state("starting");
			},
			isCurrent: () => current,
			sleep: async () => undefined,
		});
		expect(calls).toBe(1);
		expect(result).toEqual({ phase: "cancelled" });
	});

	test("it gives up in time instead of preparing forever", async () => {
		let clock = 0;
		const result = await watchWorkspacePreparation("new-one", {
			fetch: async () => state("starting"),
			isCurrent: () => true,
			now: () => clock,
			sleep: async (milliseconds) => {
				clock += milliseconds;
			},
			intervalMs: 100,
			timeoutMs: 250,
		});
		expect(result.phase).toBe("failed");
		if (result.phase === "failed") expect(result.reason).toContain("in time");
	});
});
