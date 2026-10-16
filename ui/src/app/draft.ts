import type { WireDraft, WireDraftAttachment } from "./wire";

/**
 * The composer's draft, as a value: the words, and the files that already staged. It is the
 * workspace's, not the browser's — one is saved and shown in the room it was written in — so
 * this module is where the console decides which of two copies is the one on screen.
 */
export interface Draft {
	text: string;
	attachments: WireDraftAttachment[];
}

/** The draft of one room, named: which conversation the words belong to, so a switch cannot
 * show one room's half-thought in another. */
export interface RoomDraft extends Draft {
	conversation: string;
}

export const NO_DRAFT: Draft = { text: "", attachments: [] };

/** Same words and same files. Ids are the identity: a file of the same name is another upload. */
export function sameDraft(a: Draft, b: Draft): boolean {
	return (
		a.text === b.text &&
		a.attachments.length === b.attachments.length &&
		a.attachments.every((file, index) => file.id === b.attachments[index]?.id)
	);
}

/**
 * The draft the composer shows, from the three copies that exist: this machine's own edit
 * while it may not have landed, the server's copy, and the last value this client wrote or
 * read. The newest copy wins, and only the gateway's stamp can say which that is.
 *
 * The order is the whole rule:
 *
 * 1. An edit of this machine's wins. The person is typing on this keyboard, and whatever the
 *    server has is older than the words it cannot have seen yet. Two machines typing into one
 *    room is a race the server settles by arrival; the console only stays honest about what it
 *    is holding.
 * 2. The server's copy wins when it moved after the last thing this client wrote or read.
 *    That is another machine's edit, or the clear that follows a message sent from one.
 * 3. Otherwise the last value this client wrote stays on screen. A state event is built from
 *    the state at the moment it was raised, so an echo raised before a save landed carries
 *    older words; letting it win would put them back on screen and leave nothing to correct
 *    them with until the next keystroke.
 */
export function shownDraft(copies: {
	edit?: Draft | undefined;
	server?: WireDraft | undefined;
	written?: WireDraft | undefined;
}): Draft {
	const { edit, server, written } = copies;
	if (edit !== undefined) return edit;
	if (server !== undefined && (server.updatedAt ?? 0) > (written?.updatedAt ?? 0)) {
		return { text: server.text ?? "", attachments: server.attachments ?? [] };
	}
	if (written !== undefined) {
		return { text: written.text ?? "", attachments: written.attachments ?? [] };
	}
	return NO_DRAFT;
}
