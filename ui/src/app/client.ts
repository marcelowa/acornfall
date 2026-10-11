import type { SlashCommand } from "./view-models";
import type {
	WireAuthEvent,
	WireCommands,
	WireFrame,
	WireSender,
	WireState,
	WireView,
} from "./wire";

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
	onAuth?: ((authId: string, event: WireAuthEvent) => void) | undefined;
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
		if (frame.type === "auth" && frame.authId !== undefined && frame.event !== undefined) {
			handlers.onAuth?.(frame.authId, frame.event);
			return;
		}
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

export function compactConversation(workspace: string, conversation: string): Promise<void> {
	return post(
		workspacePath(workspace, `/conversations/${encodeURIComponent(conversation)}/compact`),
		{},
	);
}

export function abortConversation(workspace: string, conversation: string): Promise<void> {
	return post(
		workspacePath(workspace, `/conversations/${encodeURIComponent(conversation)}/abort`),
		{},
	);
}

/** What this conversation chose. An absent field is left alone; an empty string clears it. */
export interface AgentChange {
	provider?: string;
	modelId?: string;
	thinkingLevel?: string;
	definition?: string;
}

/** Applied changes answer with the new state, so a picker does not need a second round trip. */
export async function setAgent(
	workspace: string,
	conversation: string,
	change: AgentChange,
): Promise<WireState> {
	const response = await fetch(
		workspacePath(workspace, `/conversations/${encodeURIComponent(conversation)}/agent`),
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(change),
		},
	);
	if (!response.ok) throw new Error((await response.text()).trim() || response.statusText);
	return (await response.json()) as WireState;
}

export function removeWorkspace(name: string): Promise<void> {
	return post(`/api/workspaces/${encodeURIComponent(name)}/remove`, {});
}

export function createWorkspace(name: string): Promise<void> {
	return post("/api/workspaces", { name });
}

/** A new conversation, created and selected; the answer is the state it is now in. */
export async function createConversation(workspace: string): Promise<WireState> {
	const response = await fetch(workspacePath(workspace, "/conversations"), { method: "POST" });
	if (!response.ok) throw new Error((await response.text()).trim() || response.statusText);
	return (await response.json()) as WireState;
}

/** A partial update: an absent field is left alone, so `image` and `network` are independent. */
export interface WorkspaceChange {
	title?: string;
	image?: string;
	network?: string;
}

export function updateWorkspace(workspace: string, change: WorkspaceChange): Promise<void> {
	return post(workspacePath(workspace, "/update"), change);
}

/** Where a default is being set: this workspace, or every workspace. */
export type DefaultScope = "workspace" | "install";

function defaultPath(workspace: string, scope: DefaultScope, kind: string): string {
	return scope === "install"
		? `/api/defaults/${kind}`
		: workspacePath(workspace, `/default-${kind}`);
}

export function setDefaultModel(
	workspace: string,
	scope: DefaultScope,
	value: string,
): Promise<void> {
	const slash = value.indexOf("/");
	return post(defaultPath(workspace, scope, "model"), {
		provider: slash === -1 ? "" : value.slice(0, slash),
		modelId: slash === -1 ? "" : value.slice(slash + 1),
	});
}

export function setDefaultThinking(
	workspace: string,
	scope: DefaultScope,
	level: string,
): Promise<void> {
	return post(defaultPath(workspace, scope, "thinking"), { level });
}

export function setDefaultAgent(
	workspace: string,
	scope: DefaultScope,
	definition: string,
): Promise<void> {
	return post(defaultPath(workspace, scope, "agent"), { definition });
}

export async function fetchCommands(workspace: string): Promise<SlashCommand[]> {
	const response = await fetch(workspacePath(workspace, "/commands"));
	if (!response.ok) throw new Error((await response.text()).trim() || response.statusText);
	const body = (await response.json()) as WireCommands;
	return body.commands;
}

/** The login methods a provider offers. Empty is ambient-only: nothing to type. */
export type ProviderAuthType = "api_key" | "oauth";

/** Start a login flow. Prompts arrive as auth frames on the stream. Answers with the flow id. */
export async function startProviderLogin(
	workspace: string,
	providerId: string,
	authType: ProviderAuthType,
): Promise<string> {
	const response = await fetch(workspacePath(workspace, "/providers/login"), {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ providerId, authType }),
	});
	if (!response.ok) throw new Error((await response.text()).trim() || response.statusText);
	return ((await response.json()) as { authId: string }).authId;
}

/** Forget one provider's stored key. Ambient keys cannot be removed this way. */
export function logoutProvider(workspace: string, providerId: string): Promise<void> {
	return post(workspacePath(workspace, "/providers/logout"), { providerId });
}

/** Re-read the provider catalog, for a key added outside the app. */
export function refreshProviders(workspace: string): Promise<void> {
	return post(workspacePath(workspace, "/providers/refresh"), {});
}

/** Answer one login prompt. A blank answer with cancelled rejects it. */
export function answerAuthPrompt(
	workspace: string,
	authId: string,
	promptId: string,
	value: string,
	cancelled = false,
): Promise<void> {
	return post(workspacePath(workspace, "/auth/answer"), { authId, promptId, value, cancelled });
}

/** Abort a running login flow. */
export function cancelAuthFlow(workspace: string, authId: string): Promise<void> {
	return post(workspacePath(workspace, "/auth/cancel"), { authId });
}

/** The update screen, as the gateway reports it. `available` is one dot, not a list. */
export interface UpdateStatus {
	current: string;
	latest: string;
	notes: string;
	pinned: string;
	channel: string;
	autoCheck: boolean;
	checking: boolean;
	/** Download sizes in bytes, for the size line. Zero when unknown. */
	downloadSize: number;
	workerSize: number;
	available: boolean;
	failed?: string | undefined;
	restartRequired?: boolean | undefined;
	backups: string[];
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
	const response = await fetch(path, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body ?? {}),
	});
	if (!response.ok) throw new Error((await response.text()).trim() || response.statusText);
	return (await response.json()) as T;
}

export async function fetchUpdateStatus(): Promise<UpdateStatus> {
	const response = await fetch("/api/update/status");
	if (!response.ok) throw new Error((await response.text()).trim() || response.statusText);
	return (await response.json()) as UpdateStatus;
}

/** Force a release check now. */
export function checkUpdate(): Promise<UpdateStatus> {
	return postJson<UpdateStatus>("/api/update/check", {});
}

/** Back up, download, verify, swap. The process stays old until it restarts. */
export function applyUpdate(cleanVMs: boolean, drain: "wait" | "stop"): Promise<UpdateStatus> {
	return postJson<UpdateStatus>("/api/update/apply", { cleanVMs, drain });
}

/** Restore the last good build. */
export function rollbackUpdate(): Promise<UpdateStatus> {
	return postJson<UpdateStatus>("/api/update/rollback", {});
}

export interface UpdatePrefs {
	channel?: string;
	autoCheck?: boolean;
	pinned?: string;
}

/** The Updates tab: channel, auto-check, pinned tag. Pinned means no prompts. */
export function setUpdatePrefs(prefs: UpdatePrefs): Promise<UpdateStatus> {
	return postJson<UpdateStatus>("/api/update/settings", prefs);
}
