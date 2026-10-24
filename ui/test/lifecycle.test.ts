import { describe, expect, test } from "bun:test";
import { isReady, readinessSentence, toLifecycle } from "@/app/map";

/**
 * A workspace says when it can be used. The console used to decide for itself out of WorkerUp, so it
 * offered "New conversation" and a composer to a workspace whose harness was not there yet, and the
 * person got "harness down" for an action the console had just offered.
 */
describe("the workspace lifecycle", () => {
	test("the gateway's phase is what the interface acts on", () => {
		expect(toLifecycle({ workerUp: true, lifecycle: { phase: "ready" } })).toEqual({
			phase: "ready",
			reason: undefined,
		});
		expect(isReady({ phase: "ready" })).toBe(true);
		expect(isReady({ phase: "starting" })).toBe(false);
		expect(isReady({ phase: "failed", reason: "exit status 1" })).toBe(false);
	});

	test("an older gateway is read the old way", () => {
		expect(toLifecycle({ workerUp: true })).toEqual({ phase: "ready", reason: undefined });
		expect(toLifecycle({ workerUp: false }).phase).toBe("starting");
	});

	test("what to say is one sentence, and it carries the reason", () => {
		expect(readinessSentence({ phase: "ready" })).toBeUndefined();
		expect(readinessSentence({ phase: "starting", reason: "the harness is starting" })).toBe(
			"This workspace is starting: the harness is starting",
		);
		expect(readinessSentence({ phase: "failed", reason: "exit status 1" })).toBe(
			"This workspace's harness is down: exit status 1",
		);
		// A phase with no words of its own still says something: a blank title is a control that
		// refuses to explain itself.
		expect(readinessSentence({ phase: "failed" })).toBe("This workspace's harness is down.");
	});
});
