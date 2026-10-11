/**
 * Attachments: files riding with a message, stored where the sandbox reads
 * them and the host cannot — the workspace's hidden folder, never a host
 * path. This file holds the pure half: caps, names, and shapes. The command
 * handlers in main.ts do the bytes.
 */

/** One file may be this big; the gateway's upload limit fits it with margin. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
/** One message may carry this many files and this many bytes in total. */
export const MAX_ATTACHMENTS_PER_MESSAGE = 20;
export const MAX_ATTACHMENTS_TOTAL_BYTES = 100 * 1024 * 1024;
/** A text file past this rides as a path, not inline: the context is not storage. */
export const INLINE_TEXT_MAX_BYTES = 100 * 1024;

export const ATTACHMENTS_DIR = ".attachments";

export interface AttachmentMeta {
	id: string;
	name: string;
	size: number;
	mime: string;
}

export type AttachmentShape = "image" | "text" | "path";

const TEXT_EXTENSIONS = new Set([
	"txt",
	"md",
	"markdown",
	"json",
	"csv",
	"tsv",
	"log",
	"yaml",
	"yml",
	"toml",
	"xml",
	"html",
	"css",
	"js",
	"mjs",
	"cjs",
	"ts",
	"tsx",
	"jsx",
	"go",
	"py",
	"rb",
	"rs",
	"java",
	"c",
	"h",
	"cpp",
	"hpp",
	"sh",
	"sql",
	"proto",
	"diff",
	"patch",
]);

/** The client's name, cut to a base name: no folders, no empties, no novels. */
export function safeName(name: string): string {
	const base = name.split(/[\\/]/).pop()?.trim() ?? "";
	if (base === "" || base === "." || base === "..") return "file";
	return base.slice(0, 100);
}

function extensionOf(name: string): string {
	const dot = name.lastIndexOf(".");
	if (dot === -1) return "";
	return name
		.slice(dot + 1)
		.toLowerCase()
		.replace(/[^a-z0-9]/g, "");
}

/** The stored file: the id, so names cannot collide or escape; the suffix, so types survive. */
export function storedName(id: string, name: string): string {
	const ext = extensionOf(name);
	return ext === "" ? id : `${id}.${ext}`;
}

/** Metadata ride-along, read back when the message is sent. */
export function metaName(id: string): string {
	return `${id}.json`;
}

/** Bytes as the transcript says them: 12 KB, not 12000. */
export function formatAttachmentSize(bytes: number): string {
	if (bytes < 1000) return `${bytes} B`;
	if (bytes < 1_000_000) return `${Math.round(bytes / 1000)} KB`;
	return `${Math.round((bytes / 1_000_000) * 10) / 10} MB`;
}

/**
 * How the model gets the file: images as provider image parts, small text
 * inline, everything else as a sandbox path its tools can read. The suffix
 * decides when the mime says nothing useful.
 */
export function shapeFor(mime: string, name: string): AttachmentShape {
	if (mime.startsWith("image/")) return "image";
	if (mime.startsWith("text/")) return "text";
	if (TEXT_EXTENSIONS.has(extensionOf(name))) return "text";
	return "path";
}

/** One transcript line per file, so a sent message shows what rode with it. */
export function attachmentLine(meta: AttachmentMeta): string {
	return `Attached: ${meta.name} (${formatAttachmentSize(meta.size)})`;
}
