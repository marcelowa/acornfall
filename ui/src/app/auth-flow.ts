/**
 * One provider login, as the connect dialog renders it: which provider, which method, what
 * the provider has said so far, and what it is waiting for. Pure folds, so the rules are
 * tested without a browser — `docs/adr/0003-provider-credentials.md` is the flow this mirrors.
 *
 * Two things live here because a flow outlives any single render:
 *
 * - A worker answers a login start faster than the HTTP reply that names it, so frames can
 *   arrive before the interface knows which flow they belong to. They wait by auth id and are
 *   folded in when the flow is named: a dropped prompt is a dialog with nothing to paste into.
 * - Progress is a line, not a pile. The provider's "listening…"/"exchanging…" chatter says
 *   where the flow is and the newest line supersedes the rest. Instructions — a URL to open, a
 *   device code, an info line — stay, because they are what the person is being asked to do.
 */
import type { ProviderAuthType } from "./client";
import type { ProviderSummary } from "./view-models";
import type { WireAuthEvent, WireAuthNotice } from "./wire";

/** What a notice is when it is an instruction rather than a status: it stays on screen. */
export type AuthNotice = Extract<WireAuthNotice, { kind: "info" | "auth_url" | "device_code" }>;

/** The prompt waiting for an answer: one question, one field or one choice. */
export type AuthPrompt = Extract<WireAuthEvent, { kind: "prompt" }>;

/** One provider login in flight: the dialog renders this, nothing else. */
export interface AuthFlow {
	authId: string;
	provider: ProviderSummary;
	method: ProviderAuthType;
	/** Instructions so far: links, codes, notes. The newest of a kind replaces the older. */
	notices: AuthNotice[];
	/** The provider's latest "working on it" line. */
	progress?: string | undefined;
	/** The question waiting for an answer, if any. */
	prompt?: AuthPrompt | undefined;
	/** An answer is on its way: the prompt's controls wait for it. */
	answering: boolean;
	/** An answer landed: with no prompt left, the flow is the provider's to finish. */
	answered: boolean;
	/** How the flow ended, when it ended. The dialog stays open to say so. */
	outcome?: { ok: true } | { ok: false; message: string } | undefined;
}

/**
 * A flow as it starts, with whatever arrived before it was named. Folding rather than
 * assigning keeps one rule for events: an early prompt lands exactly as a later one would.
 */
export function authFlowStarted(
	authId: string,
	provider: ProviderSummary,
	method: ProviderAuthType,
	events: readonly WireAuthEvent[],
): AuthFlow {
	const base: AuthFlow = {
		authId,
		provider,
		method,
		notices: [],
		answering: false,
		answered: false,
	};
	return events.reduce(foldAuthEvent, base);
}

/** The one rule for an event: prompts replace prompts, outcomes end the flow, the rest show. */
export function foldAuthEvent(flow: AuthFlow, event: WireAuthEvent): AuthFlow {
	switch (event.kind) {
		case "prompt":
			return { ...flow, prompt: event, answering: false };
		case "done":
			return { ...flow, prompt: undefined, answering: false, outcome: { ok: true } };
		case "error":
			return {
				...flow,
				prompt: undefined,
				answering: false,
				outcome: { ok: false, message: event.message },
			};
		case "progress":
			// Anything the provider says means the answer that was in flight has landed.
			return { ...flow, progress: event.message, answering: false };
		case "info":
		case "auth_url":
		case "device_code":
			return { ...flow, notices: withNotice(flow.notices, event), answering: false };
	}
}

/** A second URL or code supersedes the first; the newest instruction is the one to follow. */
function withNotice(notices: AuthNotice[], event: AuthNotice): AuthNotice[] {
	if (event.kind === "auth_url" || event.kind === "device_code") {
		return [...notices.filter((notice) => notice.kind !== event.kind), event];
	}
	if (notices.some((notice) => notice.kind === "info" && notice.message === event.message)) {
		return notices;
	}
	return [...notices, event];
}

/**
 * An answer that reached the server: the provider owns the flow now, so the question goes.
 * The line the dialog shows in its place comes from `answered`, not from a stale prompt.
 */
export function authFlowAnswered(flow: AuthFlow): AuthFlow {
	return { ...flow, prompt: undefined, answering: false, answered: true };
}

/** An answer that could not be sent: the question stays, and the controls come back. */
export function authFlowAnswerFailed(flow: AuthFlow): AuthFlow {
	return { ...flow, answering: false };
}

/**
 * Frames for a flow the interface does not know yet, by auth id. Bounded on both axes: a frame
 * that never finds its flow is another tab's business, and this is a waiting room, not a log.
 */
export type AuthWaiting = Map<string, WireAuthEvent[]>;

const WAITING_FLOWS = 8;
const WAITING_EVENTS = 32;

export function rememberAuthEvent(
	waiting: AuthWaiting,
	authId: string,
	event: WireAuthEvent,
): void {
	const events = waiting.get(authId) ?? [];
	events.push(event);
	if (events.length > WAITING_EVENTS) events.splice(0, events.length - WAITING_EVENTS);
	// Re-inserted so the map's order is least-recently-seen first.
	waiting.delete(authId);
	waiting.set(authId, events);
	while (waiting.size > WAITING_FLOWS) {
		const oldest = waiting.keys().next().value;
		if (oldest === undefined) break;
		waiting.delete(oldest);
	}
}

/** The frames that arrived before the flow was named, in the order the provider sent them. */
export function takeAuthEvents(waiting: AuthWaiting, authId: string): WireAuthEvent[] {
	const events = waiting.get(authId) ?? [];
	waiting.delete(authId);
	return events;
}
