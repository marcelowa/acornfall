import { describe, expect, test } from "bun:test";
import { trackBuild } from "../src/app/update";

describe("trackBuild", () => {
	test("the first sight sets the baseline and never reloads", () => {
		expect(trackBuild(undefined, "v0.9.20")).toEqual({
			seen: "v0.9.20",
			reload: false,
		});
	});

	test("the same build never reloads", () => {
		expect(trackBuild("v0.9.20", "v0.9.20")).toEqual({
			seen: "v0.9.20",
			reload: false,
		});
	});

	test("a different build reloads", () => {
		expect(trackBuild("v0.9.20", "v0.9.21")).toEqual({
			seen: "v0.9.20",
			reload: true,
		});
	});

	test("an empty sighting says nothing", () => {
		expect(trackBuild("v0.9.20", "")).toEqual({ seen: "v0.9.20", reload: false });
		expect(trackBuild("v0.9.20", undefined)).toEqual({
			seen: "v0.9.20",
			reload: false,
		});
	});
});
