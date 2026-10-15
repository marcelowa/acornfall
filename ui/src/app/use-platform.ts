import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	abortConversation,
	answerAuthPrompt,
	applyUpdate,
	cancelAuthFlow,
	checkUpdate,
	compactConversation,
	createConversation as createConversationRequest,
	fetchCompactPreview,
	fetchUpdateStatus,
	createWorkspace as createWorkspaceRequest,
	fetchCommands,
	fetchState,
	forkConversation,
	hideConversation,
	logoutProvider,
	openStream,
	refreshProviders,
	removeWorkspace as removeWorkspaceRequest,
	restartUpdate,
	renameConversation,
	rollbackUpdate,
	sendMessage,
	uploadAttachment,
	setAgent,
	setDefaultAgent,
	setDefaultModel,
	setDefaultThinking,
	setUpdatePrefs as saveUpdatePrefs,
	startProviderLogin,
	type UploadedAttachment,
	updateWorkspace,
	type AgentChange,
	type CompactPreview,
	type DefaultScope,
	type ProviderAuthType,
	type UpdatePrefs,
	type UpdateStatus,
} from "./client";
import {
	authFlowAnswerFailed,
	authFlowAnswered,
	authFlowStarted,
	foldAuthEvent,
	rememberAuthEvent,
	takeAuthEvents,
	type AuthFlow,
	type AuthWaiting,
} from "./auth-flow";
import { foldContext, lastUsage, type ContextRequest } from "./context";
import { trackBuild } from "./update";
import {
	contextWindowFor,
	stalePins,
	textOf,
	toAgentGroups,
	toConversation,
	toModelChoices,
	toModelGroups,
	toProviders,
	toSandbox,
	toScopeDefaults,
	toThinkingGroups,
	toTranscript,
	toWorkspaces,
} from "./map";
import type {
	BusyAction,
	ChoicePicker,
	ConversationSummary,
	PickerGroup,
	ProviderSummary,
	SandboxSummary,
	SlashCommand,
	TranscriptEntry,
	WorkspaceSummary,
} from "./view-models";
import type { WireResolvedAgent, WireSender, WireState, WireUsage, WireView } from "./wire";

const RAIL_WIDTH_KEY = "acornfall.ui.railWidth";
const RAIL_COLLAPSED_KEY = "acornfall.ui.railCollapsed";
const SEEN_KEY = "acornfall.seen";
const THEME_KEY = "acornfall.ui.theme";

interface Route {
	/** Which of the interface's screens is in view; the conversation is the one behind them. */
	screen: Screen;
	workspace: string;
	conversation: string;
	/** Which settings page is open. Only the settings screen reads it. */
	settingsTab: SettingsTab;
	/** Which release the update page is on; empty means the newest. */
	updateTag: string;
}

/** The screens the URL can name. A conversation is one of them, because it has a URL too. The
 * workspaces list is not: it is a layer over the conversation, and it keeps no URL of its own
 * (step 06), so no address can land on it. */
export type Screen = "conversation" | "settings" | "update";

/** The settings pages, each with its own URL under /settings. `install` is the install-wide
 * page: what runs, and how it keeps itself current. The old `updates` page is gone, and it kept
 * no redirect — the release page has its own address now. */
export type SettingsTab = "defaults" | "providers" | "install";

const SETTINGS_TABS: SettingsTab[] = ["defaults", "providers", "install"];

function settingsTabFrom(segment: string | undefined): SettingsTab {
	return SETTINGS_TABS.includes(segment as SettingsTab) ? (segment as SettingsTab) : "defaults";
}

/**
 * The theme someone chose. `system` is the default and a choice like any other: picking it
 * back up means following the system again, which is not the same as having chosen light.
 */
function storedTheme(): "light" | "dark" | "system" {
	try {
		const raw = window.localStorage.getItem(THEME_KEY);
		const value: unknown = raw === null ? null : JSON.parse(raw);
		return value === "light" || value === "dark" || value === "system" ? value : "system";
	} catch {
		return "system";
	}
}

function systemTheme(): "light" | "dark" {
	return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** The URL scheme the gateway routes: /c/<workspace>/<conversation>, /w/<workspace>, the
 * settings screen, and one page per settings tab. Settings remembers the workspace in a query
 * so a reload shows the one it was about. `/workspaces` is no longer an address: it was the
 * list's own page, and the list is a layer now, so an old link lands on the conversation
 * instead of on nothing. */
export function routeFromUrl(path: string, search: string): Route {
	const settings = /^\/settings(?:\/([^/]+))?\/?$/.exec(path);
	if (settings !== null) {
		return {
			screen: "settings",
			workspace: new URLSearchParams(search).get("workspace") ?? "",
			conversation: "",
			settingsTab: settingsTabFrom(settings[1]),
			updateTag: "",
		};
	}
	// The release page: /update is the newest release, /update/<tag> a version page.
	const update = /^\/update(?:\/([^/]+))?\/?$/.exec(path);
	if (update !== null) {
		return {
			screen: "update",
			workspace: new URLSearchParams(search).get("workspace") ?? "",
			conversation: "",
			settingsTab: "defaults",
			updateTag: update[1] === undefined ? "" : decodeURIComponent(update[1]),
		};
	}
	const conversation = /^\/c\/([^/]+)\/([^/]+)\/?$/.exec(path);
	if (conversation !== null) {
		return {
			screen: "conversation",
			workspace: decodeURIComponent(conversation[1] ?? ""),
			conversation: decodeURIComponent(conversation[2] ?? ""),
			settingsTab: "defaults",
			updateTag: "",
		};
	}
	const workspace = /^\/w\/([^/]+)\/?$/.exec(path);
	if (workspace !== null) {
		return {
			screen: "conversation",
			workspace: decodeURIComponent(workspace[1] ?? ""),
			conversation: "",
			settingsTab: "defaults",
			updateTag: "",
		};
	}
	return {
		screen: "conversation",
		workspace: "",
		conversation: "",
		settingsTab: "defaults",
		updateTag: "",
	};
}

function fromUrl(): Route {
	return routeFromUrl(window.location.pathname, window.location.search);
}

/** Preferences are ours and local; a corrupt value is a fresh start, not a crash. */
function read<T>(key: string, fallback: T): T {
	try {
		const raw = window.localStorage.getItem(key);
		return raw === null ? fallback : (JSON.parse(raw) as T);
	} catch {
		return fallback;
	}
}

/** Sort key for the rail: newest first, undated last. */
function timeOf(updatedAt: Date | undefined): number {
	return updatedAt instanceof Date ? updatedAt.getTime() : Number.NEGATIVE_INFINITY;
}

/** A login in flight is the dialog's whole state, folded in `auth-flow.ts`. */
export type { AuthFlow } from "./auth-flow";

export interface Platform {
	ready: boolean;
	/** The stream is following, or trying to be. */
	connection: "live" | "reconnecting";
	/** The last action the server refused, in its own words, until it is dismissed or a later
	 * action succeeds. */
	failure?: string | undefined;
	clearFailure: () => void;
	/** Ask the server for the state again; a success clears the last refusal. */
	reload: () => void;
	workerUp: boolean;
	workerError?: string | undefined;
	conversations: ConversationSummary[];
	deleted: ConversationSummary[];
	/** The workspaces, with the one in view marked. */
	workspaces: WorkspaceSummary[];
	/** The screen in view: a conversation or settings. The workspaces list is a level of the rail
	 * over the conversations, not a screen (`workspacesOpen`). */
	screen: Screen;
	showScreen: (screen: "conversation" | "settings") => void;
	/** The workspaces list, the level above the conversations in the rail: it keeps no URL, so Back
	 * goes back to the conversations instead of leaving the console. The rail stays where it is. */
	workspacesOpen: boolean;
	openWorkspaces: () => void;
	closeWorkspaces: () => void;
	/** The settings page in view, with its own URL. */
	settingsTab: SettingsTab;
	/** Which release the update page is on, from the URL; empty means the newest. */
	updateTag: string;
	showSettingsTab: (tab: SettingsTab) => void;
	/** The release page, at its own URL, optionally on one version. */
	showUpdate: (tag?: string) => void;
	/** A conversation belongs to a workspace for life, so switching means starting over: the
	 * transcript is cleared and the next one arrives with the workspace. */
	selectWorkspace: (name: string) => void;
	/** A new conversation in the workspace in view, created and opened. */
	newConversation: () => void;
	/** Each new conversation bumps it, so the composer can claim focus even where an
	 * arrival alone must not pop the keyboard. */
	composerFocusToken: number;
	/** Where the active workspace's tools actually run. */
	sandbox?: SandboxSummary | undefined;
	/** What each scope says, before resolution: one tab per scope in the settings screen. */
	defaults: {
		workspace: { model: string; thinking: string; agent: string };
		global: { model: string; thinking: string; agent: string };
	};
	/** Set a default, in this workspace or everywhere. */
	setDefault: (kind: "model" | "thinking" | "agent", scope: DefaultScope, value: string) => void;
	/** The name a `provider/modelId` is shown under, when the providers know it. */
	modelLabel: (value: string) => string;
	/** The levels a model offers, for the thinking default that follows it. */
	thinkingFor: (model: string) => PickerGroup[];
	/** Any workspace's image and network, by name: the workspaces screen's rows are not the one
	 * in view, and its menu is where a sandbox is changed. */
	setWorkspaceSandbox: (name: string, change: { image: string; network: string }) => void;
	createWorkspace: (name: string) => void;
	removeWorkspace: (name: string) => void;
	renameWorkspace: (name: string, title: string) => void;
	/** Every provider, connected first: the settings screen lists these. */
	providers: ProviderSummary[];
	/** A login in flight, if any: the connect dialog renders it. */
	authFlow?: AuthFlow | undefined;
	/** Start connecting a provider. Prompts arrive on the stream. A refusal rejects, so the
	 * dialog can say so where the method was chosen. */
	startLogin: (provider: ProviderSummary, method: ProviderAuthType) => Promise<void>;
	/** Answer the waiting prompt. */
	answerLoginPrompt: (value: string) => void;
	/** Abort the running flow. */
	cancelLogin: () => void;
	/** Dismiss a finished flow. */
	closeLogin: () => void;
	/** Forget one provider's stored key. */
	logoutProvider: (id: string) => void;
	/** Re-read the catalog, for a key added outside the app. */
	refreshProviders: () => void;
	/** The self-update state, if the gateway answered yet. One dot, not a list. */
	update?: UpdateStatus | undefined;
	/** Ask the gateway for the update state again; a success clears the last refusal. */
	refreshUpdate: () => void;
	/** An apply is in flight: the update button is disabled until it settles. */
	applyingUpdate: boolean;
	/** Force a release check now. */
	checkUpdateNow: () => void;
	/** Back up, download, verify, swap. Refusals land in `failure`. */
	applyUpdateNow: (tag: string, cleanVMs: boolean, drain: "wait" | "stop") => void;
	/** Finish a pending update: the process replaces itself. */
	restartUpdateNow: () => void;
	/** Restore the last good build. */
	rollbackUpdateNow: () => void;
	/** The Updates tab: channel, auto-check, pinned tag. */
	setUpdatePrefs: (prefs: UpdatePrefs) => void;
	entries: TranscriptEntry[];
	active?: ConversationSummary | undefined;
	/** The conversation in view was created by another one, so its choices are not its own. */
	subagent: boolean;
	/** The worker can take a steering input mid-turn; without it the choice is stop or queue. */
	steerable: boolean;
	/** Model, thinking, and agent as the conversation resolves them, with their layer. */
	model: ChoicePicker;
	thinking: ChoicePicker;
	agent: ChoicePicker;
	/** The commands the server would expand, for the slash menu. */
	commands: SlashCommand[];
	/** What the model saw, request by request — the inspector's fold. */
	context: ContextRequest[];
	usage?: WireUsage | undefined;
	/** The running model's window, when the providers name it. */
	contextWindow?: number | undefined;
	resolved?: WireResolvedAgent | undefined;
	harness?: string | undefined;
	/** The level that was asked for when the model could not express it. */
	thinkingRequested?: string | undefined;
	railWidth?: number | undefined;
	railOpen: boolean;
	/** The desktop column: false keeps it open, which is the default. */
	railCollapsed: boolean;
	toggleRail: () => void;
	/** The effective theme, which is the system's until a choice says otherwise. */
	theme: "light" | "dark";
	/** What was chosen: light, dark, or following the system. */
	themeChoice: "light" | "dark" | "system";
	setThemeChoice: (choice: "light" | "dark" | "system") => void;
	select: (id: string) => void;
	rename: (id: string, title: string) => void;
	hide: (id: string, hidden: boolean) => void;
	fork: (at: string) => void;
	/** Start a manual compaction of the conversation in view. */
	compact: () => void;
	/** The compact dialog: open flag plus the counted scope. */
	compactOpen: boolean;
	compactPreview?: CompactPreview | undefined;
	openCompactDialog: () => void;
	closeCompactDialog: () => void;
	send: (text: string, whenBusy: BusyAction, attachments?: string[] | undefined) => Promise<void>;
	/** Stage files picked in the composer; ids ride with the next send. */
	upload: (file: File) => Promise<UploadedAttachment>;
	abort: () => void;
	setRailWidth: (width: number) => void;
	setRailOpen: (open: boolean) => void;
}

/**
 * The app layer: it owns the platform conversation — state, the stream, the actions, and the
 * two preferences that survive a reload — and hands the screens view models plus callbacks.
 * Nothing below this hook knows a URL, and nothing above it knows a wire type.
 */
export function usePlatform(): Platform {
	const [route, setRoute] = useState<Route>(fromUrl);
	const [state, setState] = useState<WireState | undefined>(undefined);
	const [view, setView] = useState<WireView | undefined>(undefined);
	const [senders, setSenders] = useState<Record<string, WireSender>>({});
	/**
	 * The steer-or-queued mark a message was sent with, per conversation and entry id. The wire
	 * keeps no link between an inbox item and the entry it becomes, so this is the interface's own
	 * memory: `onView` claims it as the message lands. See `docs/ui-workflow/refactor-ux/09-build.md`.
	 */
	const [marks, setMarks] = useState<Record<string, Record<string, BusyAction>>>({});
	const [seen, setSeen] = useState<Record<string, string>>(() => read(SEEN_KEY, {}));
	const [railWidth, setRailWidthState] = useState<number | undefined>(
		() => read<number | null>(RAIL_WIDTH_KEY, null) ?? undefined,
	);
	const [railOpen, setRailOpen] = useState(false);
	/** The workspaces layer. It has no URL of its own, so it lives here and not in `route`; the
	 * entry a `pushState` leaves behind is what makes Back close it. */
	const [workspacesOpen, setWorkspacesOpen] = useState(false);
	const [composerFocusToken, setComposerFocusToken] = useState(0);
	const [railCollapsed, setRailCollapsed] = useState<boolean>(() =>
		read(RAIL_COLLAPSED_KEY, false),
	);
	const [system, setSystem] = useState<"light" | "dark">(systemTheme);
	const [choice, setChoice] = useState<"light" | "dark" | "system">(storedTheme);
	const theme = choice === "system" ? system : choice;
	const [connection, setConnection] = useState<"live" | "reconnecting">("live");
	const [failure, setFailure] = useState<string | undefined>(undefined);
	const [commands, setCommands] = useState<SlashCommand[]>([]);
	const [ready, setReady] = useState(false);
	const [authFlow, setAuthFlow] = useState<AuthFlow | undefined>(undefined);
	/**
	 * The auth id the dialog is rendering, and the frames that arrived before the POST that
	 * named it. A worker can answer a login start before the reply is parsed, and a frame with
	 * no flow to land in would otherwise be dropped — the dialog then waits forever on a prompt
	 * the provider already sent. The ref is written where the flow is set, not in an effect, so
	 * a frame cannot slip between the state and its own id.
	 */
	const authId = useRef<string | undefined>(undefined);
	const authWaiting = useRef<AuthWaiting>(new Map());

	const reportError = useCallback((cause: unknown): void => {
		setFailure(cause instanceof Error ? cause.message : String(cause));
	}, []);

	const clearFailure = useCallback((): void => setFailure(undefined), []);

	const workspace = route.workspace === "" ? "general" : route.workspace;
	const activeId =
		route.conversation === "" ? (state?.conversation?.id ?? "") : route.conversation;

	// The view frame does not say which conversation it belongs to, so the claim in `onView`
	// reads the one the stream is following from here.
	const activeIdRef = useRef<string | undefined>(undefined);
	useEffect(() => {
		activeIdRef.current = activeId;
	}, [activeId]);

	/** What is in the inbox and not committed yet, by its own words: how it was sent. */
	const sentMarks = useRef(new Map<string, BusyAction>());

	const workspacesOpenRef = useRef(workspacesOpen);
	useEffect(() => {
		workspacesOpenRef.current = workspacesOpen;
	}, [workspacesOpen]);

	useEffect(() => {
		const back = (): void => {
			// The level has no address of its own, so Back is its own gesture: the entry it consumed
			// is the one it pushed when it opened, which carried the same address. Popping the level
			// is all that is left — the address, the rail and the conversation are where they were.
			if (workspacesOpenRef.current) {
				setWorkspacesOpen(false);
				return;
			}
			setRoute(fromUrl());
		};
		window.addEventListener("popstate", back);
		return () => window.removeEventListener("popstate", back);
	}, []);

	useEffect(() => {
		let cancelled = false;
		// A stale transcript from the previous conversation is worse than an empty one.
		setView(undefined);
		setSenders({});

		const load = async (): Promise<void> => {
			try {
				const next = await fetchState(workspace, route.conversation);
				if (cancelled) return;
				setState(next);
				setReady(true);
				setFailure(undefined);
			} catch (cause) {
				if (!cancelled) setFailure(cause instanceof Error ? cause.message : String(cause));
			}
		};
		void load();

		const source = openStream(workspace, route.conversation, {
			onOpen: () => {
				if (!cancelled) setConnection("live");
			},
			onState: (next) => {
				if (cancelled) return;
				// A state event can be a refusal with no workspace behind it: subscribing
				// to a conversation the worker no longer knows, for instance. That is a
				// failure to report, not a state to render — setting it would wipe the
				// transcript for an explanation nobody wrote.
				if (next.workspace === undefined) {
					reportError(
						(next as unknown as { error?: unknown }).error ??
							"the stream refused the conversation",
					);
					return;
				}
				setState(next);
			},
			onView: (nextView, nextSenders) => {
				if (cancelled) return;
				// A message's steer-or-queued mark cannot come from the wire: an inbox item and the
				// entry it becomes are different records. So what was sent is remembered, and the
				// message that lands with the same words gets the mark — once, by entry id, so it
				// survives every later frame.
				const pending = sentMarks.current;
				for (const item of nextView.docs?.["pi.inbox"]?.items ?? []) {
					if (item.mode !== "steer" && item.mode !== "followUp") continue;
					const text = textOf(item.content).trim();
					if (text !== "") pending.set(text, item.mode);
				}
				const conversation = activeIdRef.current;
				const claims: Record<string, BusyAction> = {};
				for (const entry of nextView.entries ?? []) {
					if (entry.kind !== "pi.user") continue;
					const text = (entry.model ?? [])
						.map((message) => textOf(message.content))
						.join("\n")
						.trim();
					const mode = pending.get(text);
					if (mode === undefined) continue;
					pending.delete(text);
					claims[String(entry.id)] = mode;
				}
				if (conversation !== undefined && Object.keys(claims).length > 0) {
					setMarks((current) => ({
						...current,
						[conversation]: { ...current[conversation], ...claims },
					}));
				}
				setView(nextView);
				setSenders(nextSenders);
			},
			onAuth: (id, event) => {
				if (cancelled) return;
				if (authId.current !== id) {
					rememberAuthEvent(authWaiting.current, id, event);
					return;
				}
				setAuthFlow((current) =>
					current === undefined ? current : foldAuthEvent(current, event),
				);
			},
			onReconnecting: () => {
				if (!cancelled) setConnection("reconnecting");
			},
		});

		return () => {
			cancelled = true;
			source.close();
		};
	}, [workspace, route.conversation, reportError]);

	const reload = useCallback(async (): Promise<void> => {
		try {
			setState(await fetchState(workspace, route.conversation));
			setFailure(undefined);
		} catch (cause) {
			setFailure(cause instanceof Error ? cause.message : String(cause));
		}
	}, [workspace, route.conversation]);

	// Reading a conversation marks it read, which is what clears the dot.
	useEffect(() => {
		const current = state?.conversations.find((conversation) => conversation.id === activeId);
		if (current === undefined || seen[current.id] === current.lastEntryId) return;
		const next = { ...seen, [current.id]: current.lastEntryId };
		setSeen(next);
		window.localStorage.setItem(SEEN_KEY, JSON.stringify(next));
	}, [state, activeId, seen]);

	// The system decides until someone says otherwise, and still moves the theme while no
	// choice has been made.
	useEffect(() => {
		const query = window.matchMedia("(prefers-color-scheme: dark)");
		const follow = (): void => setSystem(query.matches ? "dark" : "light");
		query.addEventListener("change", follow);
		return () => query.removeEventListener("change", follow);
	}, []);

	useEffect(() => {
		document.documentElement.classList.toggle("dark", theme === "dark");
		window.localStorage.setItem(THEME_KEY, JSON.stringify(choice));
	}, [theme, choice]);

	// The commands the server would expand. They are fetched per workspace, once: the list
	// changes when the workspace's resources change, not when a conversation does.
	useEffect(() => {
		let cancelled = false;
		const load = async (): Promise<void> => {
			try {
				const list = await fetchCommands(workspace);
				if (!cancelled) setCommands(list);
			} catch (cause) {
				if (!cancelled) reportError(cause);
			}
		};
		void load();
		return () => {
			cancelled = true;
		};
	}, [workspace, reportError]);

	const conversations = useMemo(
		() =>
			(state?.conversations ?? [])
				.filter((conversation) => !conversation.hidden)
				.map((conversation) =>
					toConversation(conversation, activeId, seen[conversation.id]),
				)
				.sort((a, b) => timeOf(b.updatedAt) - timeOf(a.updatedAt)),
		[state, activeId, seen],
	);

	const contextFold = useMemo(() => foldContext(view?.entries ?? []), [view]);

	const workspaces = useMemo(
		() => toWorkspaces(state?.workspaces ?? [], state?.workspace?.name ?? ""),
		[state],
	);
	const sandbox = useMemo(
		() => (state === undefined ? undefined : toSandbox(state.sandbox)),
		[state],
	);
	const deleted = useMemo(
		() =>
			(state?.conversations ?? [])
				.filter((conversation) => conversation.hidden)
				.map((conversation) =>
					toConversation(conversation, activeId, seen[conversation.id]),
				)
				.sort((a, b) => timeOf(b.updatedAt) - timeOf(a.updatedAt)),
		[state, activeId, seen],
	);
	const runningNow =
		(state?.conversations ?? []).find((conversation) => conversation.id === activeId)
			?.running === true;
	const entries = useMemo(
		() =>
			toTranscript(
				view,
				senders,
				runningNow,
				activeId === undefined ? undefined : marks[activeId],
			),
		[view, senders, runningNow, activeId, marks],
	);
	const active = useMemo(
		() => (state?.conversations ?? []).find((conversation) => conversation.id === activeId),
		[state, activeId],
	);

	// How a turn lands while one is running: the worker has to offer steering at all, and then
	// the choice is the person's, not a heuristic.
	const choose = useCallback(
		(change: AgentChange) => {
			void setAgent(workspace, activeId, change)
				.then((next) => {
					setState(next);
					setFailure(undefined);
				})
				.catch(reportError);
		},
		[workspace, activeId, reportError],
	);

	// The composer's three choices. `state.agent` is the effective binding, so a picker shows
	// what will actually run; `inherited` says whether this conversation chose it, and
	// `defaultsOrigin` names the layer when it did not.
	const modelChoices = useMemo(() => toModelChoices(state?.providers ?? []), [state]);
	const providers = useMemo(() => toProviders(state?.providers ?? []), [state]);
	const effectiveModel =
		state === undefined ? "" : `${state.agent.provider}/${state.agent.modelId}`;
	const contextWindow = useMemo(
		() => contextWindowFor(state?.providers ?? [], effectiveModel),
		[state, effectiveModel],
	);
	const thinkingLevels =
		modelChoices.find((choice) => choice.value === effectiveModel)?.thinkingLevels ?? [];
	const thinkingValue = state?.agent.thinkingLevel ?? "";
	const agentValue =
		state?.resolved?.name ??
		(state?.agent.definition !== undefined && state.agent.definition !== ""
			? state.agent.definition
			: (state?.defaultAgent ?? ""));

	// A pin can outlive what it names; the value is still shown — it is what the conversation
	// is pinned to — and it is marked when it cannot run here any more.
	const stale = state === undefined ? { model: false, agent: false } : stalePins(state);
	// A subagent runs what its creator gave it: the pickers show that rather than offering a
	// change the gateway would not apply.
	const subagent = state?.subagent === true;
	const fixed = activeId === "" || subagent;
	const pinnedModel = modelChoices.find((choice) => choice.value === effectiveModel);

	/** Every picker can go back to inheriting: a choice has to be undoable. */
	const withDefault = (groups: PickerGroup[]): PickerGroup[] => [
		...groups,
		{ options: [{ value: "", label: "Use the default" }] },
	];

	const model: ChoicePicker = {
		value: pinnedModel?.label ?? state?.agent.modelId ?? "",
		invalid: stale.model,
		note: stale.model ? "not available here" : undefined,
		groups: withDefault(toModelGroups(state?.providers ?? [])),
		disabled: fixed || modelChoices.length === 0,
		onSelect: (value) => {
			if (value === "") {
				choose({ provider: "", modelId: "" });
				return;
			}
			const slash = value.indexOf("/");
			choose({ provider: value.slice(0, slash), modelId: value.slice(slash + 1) });
		},
	};

	const thinking: ChoicePicker = {
		value: thinkingValue,
		note:
			state !== undefined &&
			(state.agent.thinkingRequested ?? "") !== "" &&
			state.agent.thinkingRequested !== thinkingValue
				? `${state.agent.thinkingRequested ?? ""} was asked`
				: undefined,
		groups: withDefault(toThinkingGroups(thinkingLevels)),
		disabled: fixed || (thinkingLevels.length === 0 && thinkingValue === ""),
		onSelect: (value) => choose({ thinkingLevel: value }),
	};

	const agent: ChoicePicker = {
		value: agentValue,
		invalid: stale.agent,
		note: stale.agent ? "definition is gone" : subagent ? "set by its creator" : undefined,
		groups: withDefault(toAgentGroups(state?.agents ?? [])),
		disabled: fixed,
		onSelect: (value) => choose({ definition: value }),
	};

	const select = useCallback(
		(id: string) => {
			const name = state?.workspace?.name ?? workspace;
			window.history.pushState(
				null,
				"",
				`/c/${encodeURIComponent(name)}/${encodeURIComponent(id)}`,
			);
			setRailOpen(false);
			setRoute({
				screen: "conversation",
				workspace: name,
				conversation: id,
				settingsTab: "defaults",
				updateTag: "",
			});
		},
		[state, workspace],
	);

	/** The rail is the way between the screens; each one keeps its own URL so a reload and a
	 * shared link land where someone was. The workspaces list is not one of them: it is a level of
	 * the rail and keeps no address. */
	const showScreen = useCallback(
		(screen: "conversation" | "settings") => {
			if (screen === "conversation") {
				const name = state?.workspace?.name ?? workspace;
				const id = state?.conversation?.id ?? activeId;
				window.history.pushState(
					null,
					"",
					id === ""
						? `/w/${encodeURIComponent(name)}`
						: `/c/${encodeURIComponent(name)}/${encodeURIComponent(id)}`,
				);
			} else {
				// Settings are about a workspace, and each page has its own URL;
				// coming back lands on the page that was open.
				setRoute((current) => {
					window.history.pushState(
						null,
						"",
						`/settings/${current.settingsTab}?workspace=${encodeURIComponent(workspace)}`,
					);
					return { ...current, screen };
				});
				setRailOpen(false);
				return;
			}
			setRailOpen(false);
			// The conversation stays the one behind the screen: the stream keeps following it, so
			// coming back shows what happened while the screen was open.
			setRoute((current) => ({ ...current, screen }));
		},
		[state, workspace, activeId],
	);

	/** The workspace list is a level of the rail, not a layer beside it: opening it leaves the rail
	 * where it is — open on a desktop, the drawer on a phone — and fills it, so the X goes back to
	 * the conversations before it puts the rail away.
	 *
	 * It pushes its own history entry, with the address it already has, so a press of Back has
	 * something to consume: consuming it leaves the address unchanged and the conversation behind
	 * the rail never moves (J10). Without that entry Back would leave the console on a fresh tab. */
	const openWorkspaces = useCallback(() => {
		window.history.pushState(null, "", window.location.pathname + window.location.search);
		setWorkspacesOpen(true);
	}, []);

	const closeWorkspaces = useCallback(() => setWorkspacesOpen(false), []);

	/** One settings page to another: the URL moves so a reload stays where someone was. */
	const showSettingsTab = useCallback(
		(tab: SettingsTab) => {
			window.history.pushState(
				null,
				"",
				`/settings/${tab}?workspace=${encodeURIComponent(workspace)}`,
			);
			setRoute((current) => ({ ...current, screen: "settings", settingsTab: tab }));
		},
		[workspace],
	);

	/** The release page: /update is the newest release, /update/<tag> a version page. It is one of
	 * the screens, so Back returns to whatever the press came from, and a shared link lands on the
	 * release it named. */
	const showUpdate = useCallback(
		(tag?: string) => {
			const tail = tag === undefined || tag === "" ? "" : `/${encodeURIComponent(tag)}`;
			window.history.pushState(
				null,
				"",
				`/update${tail}?workspace=${encodeURIComponent(workspace)}`,
			);
			setRoute((current) => ({ ...current, screen: "update", updateTag: tag ?? "" }));
			setRailOpen(false);
		},
		[workspace],
	);

	/** Every command goes through here: a success clears the last refusal, a failure is it. */
	const act = useCallback(
		(request: Promise<unknown>, then?: () => void): void => {
			void request
				.then(() => {
					setFailure(undefined);
					then?.();
				})
				.catch(reportError);
		},
		[reportError],
	);

	const rename = useCallback(
		(id: string, title: string) => {
			act(renameConversation(workspace, id, title), () => void reload());
		},
		[act, workspace, reload],
	);
	const hide = useCallback(
		(id: string, hidden: boolean) => {
			act(hideConversation(workspace, id, hidden), () => void reload());
		},
		[act, workspace, reload],
	);
	const fork = useCallback(
		(at: string) => {
			act(forkConversation(workspace, activeId, at), () => void reload());
		},
		[act, workspace, activeId, reload],
	);
	const compact = useCallback(() => {
		act(compactConversation(workspace, activeId), () => void reload());
	}, [act, workspace, activeId, reload]);
	const [compactOpen, setCompactOpen] = useState(false);
	const [compactPreview, setCompactPreview] = useState<CompactPreview | undefined>(undefined);
	const openCompactDialog = useCallback(() => {
		setCompactOpen(true);
		setCompactPreview(undefined);
		fetchCompactPreview(workspace, activeId).then(
			(preview) => setCompactPreview(preview),
			(cause: unknown) => {
				setCompactOpen(false);
				reportError(cause);
			},
		);
	}, [workspace, activeId, reportError]);
	const closeCompactDialog = useCallback(() => {
		setCompactOpen(false);
		setCompactPreview(undefined);
	}, []);
	const send = useCallback(
		async (
			text: string,
			whenBusy: BusyAction,
			attachments?: string[] | undefined,
		): Promise<void> => {
			try {
				await sendMessage(workspace, activeId, text, whenBusy, attachments);
				setFailure(undefined);
				// The send answers 202 with no state, so the busy sign would wait for the
				// next poll. Read it now: the prompt grace is already counting.
				void reload();
			} catch (cause) {
				// The caller restores the draft; the failure is also the strip's to show.
				reportError(cause);
				throw cause;
			}
		},
		[workspace, activeId, reload, reportError],
	);
	const upload = useCallback(
		(file: File): Promise<UploadedAttachment> => uploadAttachment(workspace, file),
		[workspace],
	);
	const abort = useCallback(() => {
		act(abortConversation(workspace, activeId));
	}, [act, workspace, activeId]);

	const setRailWidth = useCallback((width: number) => {
		setRailWidthState(width);
		window.localStorage.setItem(RAIL_WIDTH_KEY, JSON.stringify(width));
	}, []);

	const toggleRail = useCallback(() => {
		setRailCollapsed((current) => {
			const next = !current;
			window.localStorage.setItem(RAIL_COLLAPSED_KEY, JSON.stringify(next));
			return next;
		});
	}, []);

	/** A conversation belongs to a workspace for life, so switching means starting over: the
	 * transcript is cleared and the next one arrives with the workspace. */
	const selectWorkspace = useCallback((name: string) => {
		window.history.pushState(null, "", `/w/${encodeURIComponent(name)}`);
		setRailOpen(false);
		// Opening a workspace leaves the layer: the row is the layer's own action.
		setWorkspacesOpen(false);
		setView(undefined);
		setRoute({
			screen: "conversation",
			workspace: name,
			conversation: "",
			settingsTab: "defaults",
			updateTag: "",
		});
	}, []);

	// A row on the workspaces screen is not the workspace in view, so the name comes from the
	// caller: the gateway takes it either way.
	const setWorkspaceSandbox = useCallback(
		(name: string, change: { image: string; network: string }) => {
			act(updateWorkspace(name, change), () => void reload());
		},
		[act, reload],
	);

	const createWorkspace = useCallback(
		(name: string) => {
			act(createWorkspaceRequest(name), () => {
				// The workspace opens on its first conversation, which the gateway makes for a
				// workspace that has none — so there is nothing to create here, and creating one
				// would leave the new workspace with two.
				window.history.pushState(null, "", `/w/${encodeURIComponent(name)}`);
				setView(undefined);
				setRoute({
					screen: "conversation",
					workspace: name,
					conversation: "",
					settingsTab: "defaults",
					updateTag: "",
				});
			});
		},
		[act],
	);

	const removeWorkspace = useCallback(
		(name: string) => {
			act(removeWorkspaceRequest(name), () => {
				// Forgetting the workspace in view leaves nowhere to stand, so the general one
				// takes over rather than an error about a workspace that just went away.
				if (name === workspace) {
					window.history.pushState(null, "", "/w/general");
					setView(undefined);
					setRoute({
						screen: "conversation",
						workspace: "general",
						conversation: "",
						settingsTab: "defaults",
						updateTag: "",
					});
					return;
				}
				void reload();
			});
		},
		[act, workspace, reload],
	);

	const renameWorkspace = useCallback(
		(name: string, title: string) => {
			act(updateWorkspace(name, { title }), () => void reload());
		},
		[act, reload],
	);

	// Provider logins. The start answers 202 with a flow id; every step after that
	// arrives as an auth frame on the stream, matched to the dialog that started it.
	const startLogin = useCallback(
		(provider: ProviderSummary, method: ProviderAuthType): Promise<void> => {
			return startProviderLogin(workspace, provider.id, method).then(
				(next) => {
					setFailure(undefined);
					authId.current = next;
					// Whatever arrived while the reply was in flight belongs to this flow.
					setAuthFlow(
						authFlowStarted(
							next,
							provider,
							method,
							takeAuthEvents(authWaiting.current, next),
						),
					);
				},
				(cause: unknown) => {
					reportError(cause);
					throw cause;
				},
			);
		},
		[workspace, reportError],
	);
	const answerLoginPrompt = useCallback(
		(value: string) => {
			if (authFlow?.prompt === undefined) return;
			const { authId: id, prompt } = { authId: authFlow.authId, prompt: authFlow.prompt };
			setAuthFlow({ ...authFlow, answering: true });
			void answerAuthPrompt(workspace, id, prompt.promptId, value).then(
				() => {
					setFailure(undefined);
					// The answer landed: the question it answered goes, and only that one.
					setAuthFlow((current) =>
						current?.authId === id
							? authFlowAnswered(current, prompt.promptId)
							: current,
					);
				},
				(cause: unknown) => {
					reportError(cause);
					// The question stays, so the answer can be given again.
					setAuthFlow((current) =>
						current?.authId === id
							? authFlowAnswerFailed(current, prompt.promptId)
							: current,
					);
				},
			);
		},
		[authFlow, reportError, workspace],
	);
	const cancelLogin = useCallback(() => {
		const id = authFlow?.authId;
		authId.current = undefined;
		setAuthFlow(undefined);
		if (id !== undefined) void cancelAuthFlow(workspace, id).catch(reportError);
	}, [authFlow, reportError, workspace]);
	const closeLogin = useCallback(() => {
		authId.current = undefined;
		setAuthFlow(undefined);
	}, []);
	const logoutProviderById = useCallback(
		(id: string) => {
			act(logoutProvider(workspace, id), () => void reload());
		},
		[act, workspace, reload],
	);
	const refreshProvidersNow = useCallback(() => {
		act(refreshProviders(workspace), () => void reload());
	}, [act, workspace, reload]);

	// The self-update state: the stream carries the summary (dot data) on
	// every state event; a fetch fills the details (notes, prefs, sizes)
	// once at load and every 15 minutes. A failed poll falls back to the
	// stream summary rather than failing the whole screen: the update
	// screen is advisory, the conversation is not.
	const [fetchedUpdate, setFetchedUpdate] = useState<UpdateStatus | undefined>(undefined);
	const updateFromState: UpdateStatus | undefined =
		state?.update === undefined
			? undefined
			: {
					current: state.update.current,
					latest: state.update.latest ?? "",
					notes: "",
					channel: "",
					autoCheck: false,
					checking: false,
					available: state.update.available,
					failed: state.update.failed,
					restartRequired: state.update.restartRequired,
					backups: [],
					downloadSize: 0,
					workerSize: 0,
					// The runs gate is the gateway's own answer, and the stream
					// summary does not carry it: the page's fetch does.
					runsActive: false,
					runs: [],
				};
	const update = fetchedUpdate ?? updateFromState;
	// The build this page first saw: an apply or rollback restarts the server
	// under us, the stream's next state names the new build, and this bundle
	// is old — reload to fetch the new one. The stream summary is the
	// freshest sighting; the fetch fills in when the stream has said nothing.
	const runningBuild = useRef<string | undefined>(undefined);
	const streamBuild = updateFromState?.current;
	const fetchedBuild = fetchedUpdate?.current;
	useEffect(() => {
		const tracked = trackBuild(runningBuild.current, streamBuild ?? fetchedBuild);
		runningBuild.current = tracked.seen;
		if (tracked.reload) window.location.reload();
	}, [streamBuild, fetchedBuild]);
	useEffect(() => {
		let cancelled = false;
		const load = async (): Promise<void> => {
			try {
				const next = await fetchUpdateStatus();
				if (!cancelled) setFetchedUpdate(next);
			} catch {
				if (!cancelled) setFetchedUpdate(undefined);
			}
		};
		void load();
		const timer = window.setInterval(
			() => {
				void load();
			},
			15 * 60 * 1000,
		);
		return () => {
			cancelled = true;
			window.clearInterval(timer);
		};
	}, []);

	const refreshUpdate = useCallback((): void => {
		void fetchUpdateStatus().then(setFetchedUpdate, reportError);
	}, [reportError]);
	const checkUpdateNow = useCallback((): void => {
		act(checkUpdate().then(setFetchedUpdate));
	}, [act]);
	const [applyingUpdate, setApplyingUpdate] = useState(false);
	const applyUpdateNow = useCallback(
		(tag: string, cleanVMs: boolean, drain: "wait" | "stop"): void => {
			const request = applyUpdate(cleanVMs, drain, tag);
			// Immediate and single: the button disables on this render, so a
			// second tap has nothing to press. Settles either way, so a
			// refusal re-enables instead of sticking disabled.
			setApplyingUpdate(true);
			const done = (): void => setApplyingUpdate(false);
			void request.then(done, done);
			act(request.then(setFetchedUpdate));
		},
		[act],
	);
	const restartUpdateNow = useCallback((): void => {
		// The gateway answers before it becomes the new binary; the stream drops
		// and reconnects on its own, and the page follows the build from there.
		act(restartUpdate().then(setFetchedUpdate));
	}, [act]);
	const rollbackUpdateNow = useCallback((): void => {
		act(rollbackUpdate().then(setFetchedUpdate));
	}, [act]);
	const setUpdatePrefs = useCallback(
		(prefs: UpdatePrefs): void => {
			act(saveUpdatePrefs(prefs).then(setFetchedUpdate));
		},
		[act],
	);

	const newConversation = useCallback(() => {
		// The drawer covers the conversation on a phone, and the new room is for typing:
		// close it now so it never lingers over the request, and again on arrival.
		setRailOpen(false);
		void createConversationRequest(workspace)
			.then((created) => {
				setFailure(undefined);
				const id = created.conversation?.id ?? "";
				window.history.pushState(
					null,
					"",
					`/c/${encodeURIComponent(workspace)}/${encodeURIComponent(id)}`,
				);
				setView(undefined);
				setRailOpen(false);
				setComposerFocusToken((token) => token + 1);
				setRoute({
					screen: "conversation",
					workspace,
					conversation: id,
					settingsTab: "defaults",
					updateTag: "",
				});
			})
			.catch(reportError);
	}, [workspace, reportError]);

	const setDefault = useCallback(
		(kind: "model" | "thinking" | "agent", scope: DefaultScope, value: string) => {
			const request =
				kind === "model"
					? setDefaultModel(workspace, scope, value)
					: kind === "thinking"
						? setDefaultThinking(workspace, scope, value)
						: setDefaultAgent(workspace, scope, value);
			act(request, () => void reload());
		},
		[act, workspace, reload],
	);

	const defaults = useMemo(
		() => ({
			workspace: toScopeDefaults(state?.workspaceDefaults),
			global: toScopeDefaults(state?.installDefaults),
		}),
		[state],
	);

	const modelLabel = useCallback(
		(value: string): string =>
			modelChoices.find((choice) => choice.value === value)?.label ??
			value.split("/").at(-1) ??
			"",
		[modelChoices],
	);

	const thinkingFor = useCallback(
		(model: string): PickerGroup[] =>
			toThinkingGroups(
				modelChoices.find((choice) => choice.value === model)?.thinkingLevels ?? [],
			),
		[modelChoices],
	);

	return {
		ready,
		connection,
		failure,
		clearFailure,
		reload: () => {
			void reload();
		},
		conversations,
		deleted,
		entries,
		active:
			active === undefined ? undefined : toConversation(active, activeId, seen[active.id]),
		subagent,
		workerUp: state?.workerUp ?? false,
		workerError: state?.workerError,
		steerable: state?.capabilities.steer ?? false,
		model,
		thinking,
		agent,
		commands,
		context: contextFold,
		workspaces,
		sandbox,
		selectWorkspace,
		defaults,
		setDefault,
		modelLabel,
		thinkingFor,
		setWorkspaceSandbox,
		createWorkspace,
		removeWorkspace,
		usage: lastUsage(view?.entries ?? []),
		contextWindow,
		resolved: state?.resolved,
		thinkingRequested: state?.agent.thinkingRequested,
		harness: state?.harness,
		railWidth,
		railOpen,
		railCollapsed,
		toggleRail,
		theme,
		themeChoice: choice,
		setThemeChoice: setChoice,
		screen: route.screen,
		showScreen,
		settingsTab: route.settingsTab,
		showSettingsTab,
		updateTag: route.updateTag,
		showUpdate,
		newConversation,
		composerFocusToken,
		select,
		rename,
		hide,
		fork,
		compact,
		compactOpen,
		compactPreview,
		openCompactDialog,
		closeCompactDialog,
		send,
		upload,
		abort,
		setRailWidth,
		setRailOpen,
		workspacesOpen,
		openWorkspaces,
		closeWorkspaces,
		renameWorkspace,
		providers,
		authFlow,
		startLogin,
		answerLoginPrompt,
		cancelLogin,
		closeLogin,
		logoutProvider: logoutProviderById,
		refreshProviders: refreshProvidersNow,
		update,
		refreshUpdate,
		applyingUpdate,
		checkUpdateNow,
		applyUpdateNow,
		restartUpdateNow,
		rollbackUpdateNow,
		setUpdatePrefs,
	};
}
