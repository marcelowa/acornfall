import type { SlashCommand } from "./view-models";
import type {
	WireAuthEvent,
	WireCommands,
	WireDraft,
	WireDraftAttachment,
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
	attachments?: string[] | undefined,
): Promise<void> {
	return post(
		workspacePath(workspace, `/conversations/${encodeURIComponent(conversation)}/messages`),
		{
			text,
			whenBusy,
			attachments,
		},
	);
}

/**
 * Record one conversation's unsent message: the words, and the staged files riding them.
 * `keepalive` is for the write that has to leave while the page does — a reload mid-sentence
 * is the reload the draft exists for. The answer is what was stored, stamp included.
 */
export async function saveDraft(
	workspace: string,
	conversation: string,
	draft: { text: string; attachments: WireDraftAttachment[] },
	keepalive = false,
): Promise<WireDraft> {
	const response = await fetch(
		workspacePath(workspace, `/conversations/${encodeURIComponent(conversation)}/draft`),
		{
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(draft),
			keepalive,
		},
	);
	if (!response.ok) throw new Error((await response.text()).trim() || response.statusText);
	return (await response.json()) as WireDraft;
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

export interface CompactPreview {
	conversationId: string;
	entries: number;
	turns: number;
}

/** What a manual compaction would fold, so the dialog states the scope. */
export function fetchCompactPreview(
	workspace: string,
	conversation: string,
): Promise<CompactPreview> {
	return postJson<CompactPreview>(
		workspacePath(
			workspace,
			`/conversations/${encodeURIComponent(conversation)}/compact-preview`,
		),
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

/** One stored file, answered with the id messages carry. */
export interface UploadedAttachment {
	id: string;
	name: string;
	size: number;
	mime: string;
}

/** Stage one file under the workspace's hidden folder. */
export async function uploadAttachment(workspace: string, file: File): Promise<UploadedAttachment> {
	const body = new FormData();
	body.append("file", file, file.name);
	const response = await fetch(workspacePath(workspace, "/attachments"), {
		method: "POST",
		body,
	});
	if (!response.ok) throw new Error((await response.text()).trim() || response.statusText);
	return (await response.json()) as UploadedAttachment;
}

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

/** The release page, as the gateway reports it. `available` means the newest GA is newer. */
export interface UpdateStatus {
	current: string;
	latest: string;
	notes: string;
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
	/** The gateway's own runs gate, and what stopping would stop. */
	runsActive: boolean;
	runs: { workspace: string; runs: number }[];
}

/** One release, as the picker and the version page read it. */
export interface UpdateRelease {
	tag: string;
	name: string;
	notes: string;
	publishedAt: string;
	prerelease: boolean;
	downloadSize: number;
	workerSize: number;
	/** What it is next to the running build: running, newer, older, unknown. */
	relation: "running" | "newer" | "older" | "unknown";
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

/** The last twenty releases, newest first. `prerelease` widens the list for one visit. */
export async function fetchReleases(
	includePrerelease: boolean,
	limit = 20,
): Promise<UpdateRelease[]> {
	const query = new URLSearchParams({ limit: String(limit) });
	if (includePrerelease) query.set("prerelease", "1");
	const response = await fetch(`/api/update/releases?${query}`);
	if (!response.ok) throw new Error((await response.text()).trim() || response.statusText);
	const body = (await response.json()) as { releases: UpdateRelease[] };
	return body.releases;
}

/** The notes of several releases in one read: the page's "changes in between". */
export async function fetchNotes(tags: string[]): Promise<Record<string, string>> {
	if (tags.length === 0) return {};
	const query = new URLSearchParams({ tags: tags.join(",") });
	const response = await fetch(`/api/update/notes?${query}`);
	if (!response.ok) throw new Error((await response.text()).trim() || response.statusText);
	const body = (await response.json()) as { notes: Record<string, string> };
	return body.notes;
}

/** One release by name: a version outside the twenty, and the running row. */
export async function fetchRelease(tag: string): Promise<UpdateRelease> {
	const response = await fetch(`/api/update/releases/${encodeURIComponent(tag)}`);
	if (!response.ok) throw new Error((await response.text()).trim() || response.statusText);
	return (await response.json()) as UpdateRelease;
}

/** Force a release check now. */
export function checkUpdate(): Promise<UpdateStatus> {
	return postJson<UpdateStatus>("/api/update/check", {});
}

/** Back up, download, verify, swap. The process stays old until it restarts. */
export function applyUpdate(
	cleanVMs: boolean,
	drain: "wait" | "stop",
	tag = "",
): Promise<UpdateStatus> {
	return postJson<UpdateStatus>("/api/update/apply", { cleanVMs, drain, tag });
}

/** Finish a pending update: the process replaces itself with the binary on disk. */
export function restartUpdate(): Promise<UpdateStatus> {
	return postJson<UpdateStatus>("/api/update/restart", {});
}

/** Restore the last good build. */
export function rollbackUpdate(): Promise<UpdateStatus> {
	return postJson<UpdateStatus>("/api/update/rollback", {});
}

export interface UpdatePrefs {
	channel?: string;
	autoCheck?: boolean;
}

/** The install-wide settings page: channel and auto-check. There is no pin. */
export function setUpdatePrefs(prefs: UpdatePrefs): Promise<UpdateStatus> {
	return postJson<UpdateStatus>("/api/update/settings", prefs);
}
