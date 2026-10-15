import { describe, expect, test } from "bun:test";
import { refuseAttachments } from "../src/lib/attachments";

describe("refuseAttachments", () => {
	test("lets a small batch through", () => {
		expect(refuseAttachments([], [{ size: 100 }])).toBeUndefined();
	});

	test("refuses one big file", () => {
		expect(refuseAttachments([], [{ size: 11 * 1024 * 1024 }])).toBe(
			"one file carries 10 MB at most",
		);
	});

	test("refuses too many files", () => {
		const existing = Array.from({ length: 20 }, () => ({ size: 100 }));
		expect(refuseAttachments(existing, [{ size: 100 }])).toBe(
			"one message carries 20 files at most",
		);
	});

	test("refuses too many bytes", () => {
		const existing = [{ size: 99 * 1024 * 1024 }];
		expect(refuseAttachments(existing, [{ size: 2 * 1024 * 1024 }])).toBe(
			"one message carries 100 MB of files at most",
		);
	});
});
