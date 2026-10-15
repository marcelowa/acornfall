/**
 * Attachment caps, shared by the composer and its chips: the client refuses
 * fast with these, and the gateway and worker refuse again behind it.
 */

/** One file may be this big. */
export const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024;
/** One message may carry this many files and this many bytes in total. */
export const MAX_ATTACHMENTS_PER_MESSAGE = 20;
export const MAX_ATTACHMENTS_TOTAL_BYTES = 100 * 1024 * 1024;

export interface SizedFile {
	size: number;
}

/**
 * The refusal reason, when the batch does not fit: too big a file, too many
 * files, or too many bytes. Undefined means every file may upload.
 */
export function refuseAttachments(
	existing: readonly SizedFile[],
	incoming: readonly SizedFile[],
): string | undefined {
	for (const file of incoming) {
		if (file.size > MAX_ATTACHMENT_BYTES) return "one file carries 10 MB at most";
	}
	if (existing.length + incoming.length > MAX_ATTACHMENTS_PER_MESSAGE) {
		return "one message carries 20 files at most";
	}
	let total = 0;
	for (const file of [...existing, ...incoming]) total += file.size;
	if (total > MAX_ATTACHMENTS_TOTAL_BYTES) {
		return "one message carries 100 MB of files at most";
	}
	return undefined;
}
