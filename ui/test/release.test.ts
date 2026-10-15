import { describe, expect, test } from "bun:test";
import type { UpdateRelease } from "../src/app/client";
import { betweenReleases, notesTags } from "../src/components/release/release-screen";

/**
 * The "what changed in between" selection: which releases the page lists, and
 * which tags its one notes read asks for. The page must not ask for the whole
 * window when three releases sit between the running build and the target.
 */
function release(tag: string, relation: UpdateRelease["relation"]): UpdateRelease {
	return {
		tag,
		name: tag,
		notes: "",
		publishedAt: "2026-10-13T00:00:00Z",
		prerelease: false,
		downloadSize: 1,
		workerSize: 1,
		relation,
	};
}

describe("the changes in between", () => {
	test("are the list's newer rows, the target out, newest first", () => {
		const list = [
			release("v0.9.33", "newer"),
			release("v0.9.32", "newer"),
			release("v0.9.31", "newer"),
			release("v0.9.28", "running"),
			release("v0.9.20", "older"),
		];
		const between = betweenReleases(list, "v0.9.33", true);
		expect(between.map((item) => item.tag)).toEqual(["v0.9.32", "v0.9.31"]);
		expect(notesTags(between)).toEqual(["v0.9.32", "v0.9.31"]);
	});

	test("are empty when the target is not newer than the running build", () => {
		const list = [release("v0.9.33", "newer"), release("v0.9.20", "older")];
		expect(betweenReleases(list, "v0.9.20", false)).toEqual([]);
		expect(betweenReleases(undefined, "v0.9.33", true)).toEqual([]);
		expect(notesTags([])).toEqual([]);
	});

	test("ask for no empty tag", () => {
		expect(notesTags([release("v0.9.31", "newer")])).toEqual(["v0.9.31"]);
	});
});
