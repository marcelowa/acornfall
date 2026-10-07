import type { WireFrame, WireSender, WireState, WireView } from "./wire";

/**
 * The gateway client. One fetch for state, one EventSource for everything after it, and the
 * command endpoints. This is the only module in the interface that knows a URL.
 */

function workspacePath(workspace: string, tail: string): string {
	return `/api/workspaces/${encodeURIComponent(workspace)}${tail}`;
}

export async function fetchState(workspace: string, conversation: string): Promise<WireState> {
	const query = `workspace=${encodeURIComponent(workspace)}&conversation=${encodeURIComponent(conversation)}`;
	const response = await fetch(`/api/state?${query}`);
	if (!response.ok) throw new Error((await response.text()).trim() || response.statusText);
	return (await response.json()) as WireState;
}

export interface StreamHandlers {
	onOpen: () => void;
	onState: (state: WireState) => void;
	onView: (view: WireView, senders: Record<string, WireSender>) => void;
	onReconnecting: () => void;
}

export function openStream(
	workspace: string,
	conversation: string,
	handlers: StreamHandlers,
): EventSource {
	const query = `workspace=${encodeURIComponent(workspace)}&conversation=${encodeURIComponent(conversation)}`;
	const source = new EventSource(`/api/stream?${query}`);

	// The server's ping is the only event that arrives while nothing is happening, so it is
	// what proves the stream is alive rather than merely open.
	source.addEventListener("ping", () => undefined);
	source.addEventListener("open", () => handlers.onOpen());
	source.addEventListener("state", (event) => {
		handlers.onState(JSON.parse((event as MessageEvent<string>).data) as WireState);
	});
	source.addEventListener("frame", (event) => {
		const frame = JSON.parse((event as MessageEvent<string>).data) as WireFrame;
		if (frame.type !== "view" || frame.value === undefined) return;
		handlers.onView(frame.value, frame.acornfall?.senders ?? {});
	});
	source.addEventListener("error", () => handlers.onReconnecting());

	return source;
}

async function post(path: string, body: unknown): Promise<void> {
	const response = await fetch(path, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body ?? {}),
	});
	if (!response.ok) throw new Error((await response.text()).trim() || response.statusText);
}

export function sendMessage(
	workspace: string,
	conversation: string,
	text: string,
	whenBusy: "steer" | "followUp",
): Promise<void> {
	return post(
		workspacePath(workspace, `/conversations/${encodeURIComponent(conversation)}/messages`),
		{
			text,
			whenBusy,
		},
	);
}

export function renameConversation(
	workspace: string,
	conversation: string,
	title: string,
): Promise<void> {
	return post(
		workspacePath(workspace, `/conversations/${encodeURIComponent(conversation)}/rename`),
		{
			title,
		},
	);
}

export function hideConversation(
	workspace: string,
	conversation: string,
	hidden: boolean,
): Promise<void> {
	return post(
		workspacePath(workspace, `/conversations/${encodeURIComponent(conversation)}/hide`),
		{
			hidden,
		},
	);
}

export function forkConversation(
	workspace: string,
	conversation: string,
	at: string,
): Promise<void> {
	return post(
		workspacePath(workspace, `/conversations/${encodeURIComponent(conversation)}/fork`),
		{ at },
	);
}

export function abortConversation(workspace: string, conversation: string): Promise<void> {
	return post(
		workspacePath(workspace, `/conversations/${encodeURIComponent(conversation)}/abort`),
		{},
	);
}
