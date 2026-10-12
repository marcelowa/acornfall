import { describe, expect, test } from "bun:test";
import { runState, STALE_AFTER_MINUTES } from "../src/lib/clock";

const now = new Date("2026-08-29T12:00:00Z");
const minutesAgo = (minutes: number): Date => new Date(now.getTime() - minutes * 60_000);

describe("what a run flag and its age add up to", () => {
	test("a flag with no record of activity is taken at its word", () => {
		expect(runState(true, undefined, now)).toBe("running");
	});

	test("a run that moved inside the window is running", () => {
		expect(runState(true, minutesAgo(1), now)).toBe("running");
		expect(runState(true, minutesAgo(STALE_AFTER_MINUTES - 1), now)).toBe("running");
	});

	test("a run that stopped moving past the window goes stale, and keeps its dot", () => {
		expect(runState(true, minutesAgo(STALE_AFTER_MINUTES + 1), now)).toBe("stale");
	});

	test("no flag is no dot, whatever the age", () => {
		expect(runState(false, minutesAgo(1), now)).toBe("idle");
		expect(runState(false, minutesAgo(600), now)).toBe("idle");
	});
});
