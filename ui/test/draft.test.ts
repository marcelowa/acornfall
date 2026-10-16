import { describe, expect, test } from "bun:test";
import { NO_DRAFT, sameDraft, shownDraft, type Draft } from "../src/app/draft";
import type { WireDraft } from "../src/app/wire";

const file = (id: string) => ({ id, name: `${id}.png`, size: 1200, mime: "image/png" });

const draft = (text: string, ids: string[] = []): Draft => ({
	text,
	attachments: ids.map(file),
});

const wire = (text: string, updatedAt: number, ids: string[] = []): WireDraft => ({
	text,
	updatedAt,
	attachments: ids.map(file),
});

describe("the draft the composer shows", () => {
	test("an edit of this machine's wins while it is still on its way", () => {
		// The person is typing here: the server cannot have seen these words yet, so whatever
		// it holds is older by definition.
		expect(
			shownDraft({
				edit: draft("half a tho"),
				server: wire("half", 10),
				written: wire("half", 10),
			}),
		).toEqual(draft("half a tho"));
	});

	test("another machine's newer words win when nothing local is unsaved", () => {
		expect(
			shownDraft({
				server: wire("typed on the laptop", 20, ["a1"]),
				written: wire("typed on the phone", 10),
			}),
		).toEqual(draft("typed on the laptop", ["a1"]));
	});

	test("a message sent from another machine clears this one's composer", () => {
		// The send cleared the draft with a fresh stamp: the words are in the transcript, so
		// they must not still be sitting here waiting to be sent twice.
		expect(shownDraft({ server: wire("", 30), written: wire("send me", 20) })).toEqual(
			NO_DRAFT,
		);
	});

	test("an echo raised before a save landed does not put older words back", () => {
		// A state event carries the state as it was when it was raised. The save landed after
		// that, so the echo is older than what this client wrote, and the last write stays.
		expect(shownDraft({ server: wire("old", 10), written: wire("newer words", 20) })).toEqual(
			draft("newer words"),
		);
	});

	test("a room with nothing anywhere is empty", () => {
		expect(shownDraft({})).toEqual(NO_DRAFT);
		expect(shownDraft({ server: wire("", 0) })).toEqual(NO_DRAFT);
	});
});

describe("sameDraft", () => {
	test("files are the same when their ids are, whatever they are called", () => {
		expect(sameDraft(draft("hi", ["a1"]), draft("hi", ["a1"]))).toBe(true);
		expect(sameDraft(draft("hi", ["a1"]), draft("hi", ["a2"]))).toBe(false);
		expect(sameDraft(draft("hi", ["a1"]), draft("hi"))).toBe(false);
		expect(sameDraft(draft("hi"), draft("bye"))).toBe(false);
	});
});
