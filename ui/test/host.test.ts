import { describe, expect, test } from "bun:test";
import { hostSentence } from "../src/components/release/host";

const host = (overrides: Partial<NonNullable<Parameters<typeof hostSentence>[1]>> = {}) => ({
	running: true,
	version: "v0.10.0-beta.13",
	service: "v0.10.0-beta.13",
	lastError: "",
	at: "2026-10-22T09:41:00Z",
	...overrides,
});

describe("hostSentence", () => {
	test("a console that updates itself says nothing", () => {
		expect(hostSentence("", undefined)).toBe("");
	});

	test("an ask with no answer yet says so", () => {
		expect(hostSentence("v0.10.0-beta.14", undefined)).toBe(
			"v0.10.0-beta.14 was asked for, and no host has answered yet.",
		);
	});

	test("the release running and the release asked for are two facts", () => {
		expect(hostSentence("v0.10.0-beta.14", host())).toBe(
			"v0.10.0-beta.13 is running; the host was asked for v0.10.0-beta.14.",
		);
	});

	test("the release asked for is what is running", () => {
		expect(hostSentence("v0.10.0-beta.13", host())).toBe("v0.10.0-beta.13 is running.");
	});

	test("a host that has not finished an update names what failed", () => {
		expect(
			hostSentence(
				"v0.10.0-beta.14",
				host({ lastError: "applying v0.10.0-beta.14: no route to the release" }),
			),
		).toBe(
			"v0.10.0-beta.13 is running, and the host could not apply v0.10.0-beta.14: applying v0.10.0-beta.14: no route to the release",
		);
	});

	test("a machine that is not running is not claimed to be", () => {
		expect(hostSentence("", host({ running: false, version: "" }))).toBe("nothing is running.");
	});
});
