import { describe, expect, test } from "bun:test";
import { formatBytes, formatMoved } from "../src/lib/format";

const now = new Date("2026-08-29T12:00:00Z");

describe("bytes", () => {
	test("reads as the composer's chips and the update page say them", () => {
		expect(formatBytes(512)).toBe("512 B");
		expect(formatBytes(12000)).toBe("12 KB");
		expect(formatBytes(13_600_000)).toBe("13.6 MB");
	});
});

describe("when a conversation last moved", () => {
	test("reads in the few characters a rail row has", () => {
		expect(formatMoved(new Date("2026-08-29T11:59:40Z"), now)).toBe("now");
		expect(formatMoved(new Date("2026-08-29T11:48:00Z"), now)).toBe("12m");
		expect(formatMoved(new Date("2026-08-29T09:00:00Z"), now)).toBe("3h");
		expect(formatMoved(new Date("2026-08-27T12:00:00Z"), now)).toBe("2d");
		expect(formatMoved(new Date("2026-08-12T12:00:00Z"), now)).toBe("2w");
	});

	test("says nothing when the row has no timestamp to show", () => {
		expect(formatMoved(undefined, now)).toBe("");
	});

	test("a clock that runs backwards is not a negative age", () => {
		expect(formatMoved(new Date("2026-08-29T12:05:00Z"), now)).toBe("now");
	});
});
