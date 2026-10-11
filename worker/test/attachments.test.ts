/**
 * Attachments: names that cannot escape, shapes the model understands, and
 * lines the transcript can show.
 */
import { describe, expect, test } from "bun:test";
import {
	attachmentLine,
	formatAttachmentSize,
	kindName,
	partMime,
	shapeFor,
	safeName,
	storedName,
} from "../src/attachments.ts";

describe("safeName", () => {
	test("cuts folders", () => {
		expect(safeName("../../etc/passwd")).toBe("passwd");
	});

	test("falls back when nothing is left", () => {
		expect(safeName("..")).toBe("file");
		expect(safeName("")).toBe("file");
	});
});

describe("storedName", () => {
	test("keeps the id and the suffix", () => {
		expect(storedName("abc", "shot.PNG")).toBe("abc.png");
	});

	test("works with no suffix", () => {
		expect(storedName("abc", "README")).toBe("abc");
	});
});

describe("shapeFor", () => {
	test("images ride as parts", () => {
		expect(shapeFor("image/png", "shot.png")).toBe("image");
	});

	test("text rides inline", () => {
		expect(shapeFor("text/plain", "a.txt")).toBe("text");
		expect(shapeFor("application/octet-stream", "notes.md")).toBe("text");
	});

	test("the rest rides as a path", () => {
		expect(shapeFor("application/pdf", "doc.pdf")).toBe("path");
		expect(shapeFor("application/octet-stream", "blob")).toBe("path");
	});
});

describe("attachmentLine", () => {
	test("names the file with its size", () => {
		expect(attachmentLine({ id: "x", name: "shot.png", size: 12000, mime: "image/png" })).toBe(
			"Attached: shot.png (12 KB)",
		);
	});
});

describe("formatAttachmentSize", () => {
	test("says bytes as the screen does", () => {
		expect(formatAttachmentSize(512)).toBe("512 B");
		expect(formatAttachmentSize(10 * 1024 * 1024)).toBe("10.5 MB");
	});
});

describe("svg and unknown images", () => {
	test("svg rides as text, not an image part", () => {
		expect(shapeFor("image/svg+xml", "logo.svg")).toBe("text");
		expect(shapeFor("application/octet-stream", "logo.svg")).toBe("text");
	});

	test("a guessed photo still rides as a part", () => {
		expect(shapeFor("application/octet-stream", "shot.jpg")).toBe("image");
	});

	test("an unsupported raster rides as a path", () => {
		expect(shapeFor("image/tiff", "scan.tiff")).toBe("path");
	});

	test("the part carries a real mime, not octet-stream", () => {
		expect(partMime("application/octet-stream", "shot.jpg")).toBe("image/jpeg");
		expect(partMime("image/png", "shot.png")).toBe("image/png");
	});
});

describe("kindName", () => {
	test("names kinds the model can act on", () => {
		expect(kindName("application/pdf")).toBe("PDF document");
		expect(kindName("application/zip")).toBe("ZIP archive");
		expect(kindName("text/csv")).toBe("text file");
		expect(kindName("application/octet-stream")).toBe("file");
	});
});
