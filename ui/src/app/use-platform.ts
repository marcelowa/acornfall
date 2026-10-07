import { useCallback, useEffect, useMemo, useState } from "react";
import {
	abortConversation,
	createWorkspace as createWorkspaceRequest,
	fetchCommands,
	fetchState,
	forkConversation,
	hideConversation,
	openStream,
	removeWorkspace as removeWorkspaceRequest,
	renameConversation,
	sendMessage,
	setAgent,
	setDefaultAgent,
	setDefaultModel,
	setDefaultThinking,
	updateWorkspace,
	type AgentChange,
	type DefaultScope,
} from "./client";
import { foldContext, lastUsage, type ContextRequest } from "./context";
import {
	originLabel,
	toAgentGroups,
	toConversation,
	toModelChoices,
	toModelGroups,
	toSandbox,
	toThinkingGroups,
	toTranscript,
	toWorkspaces,
} from "./map";
import type {
	BusyAction,
	ConversationSummary,
	PickerGroup,
	SandboxSummary,
	SlashCommand,
	TranscriptEntry,
	WorkspaceSummary,
} from "./view-models";
import type { WireResolvedAgent, WireSender, WireState, WireUsage, WireView } from "./wire";

const RAIL_WIDTH_KEY = "acornfall.ui.railWidth";
const RAIL_COLLAPSED_KEY = "acornfall.ui.railCollapsed";
const INSPECTOR_OPEN_KEY = "acornfall.ui.inspectorOpen";
const INSPECTOR_MAXIMIZED_KEY = "acornfall.ui.inspectorMaximized";
const SEEN_KEY = "acornfall.seen";
const THEME_KEY = "acornfall.ui.theme";

interface Route {
	workspace: string;
	conversation: string;
}

/**
 * The theme someone chose, or null while the system is still the one deciding. The stored
 * value is JSON, as every other preference here is.
 */
function storedTheme(): "light" | "dark" | null {
	try {
		const raw = window.localStorage.getItem(THEME_KEY);
		const value: unknown = raw === null ? null : JSON.parse(raw);
		return value === "light" || value === "dark" ? value : null;
	} catch {
		return null;
	}
}

function systemTheme(): "light" | "dark" {
	return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

/** The URL scheme the gateway already routes: /c/<workspace>/<conversation> and /w/<workspace>. */
function fromUrl(): Route {
	const conversation = /^\/c\/([^/]+)\/([^/]+)\/?$/.exec(window.location.pathname);
	if (conversation !== null) {
		return {
			workspace: decodeURIComponent(conversation[1] ?? ""),
			conversation: decodeURIComponent(conversation[2] ?? ""),
		};
	}
	const workspace = /^\/w\/([^/]+)\/?$/.exec(window.location.pathname);
	if (workspace !== null) {
		return { workspace: decodeURIComponent(workspace[1] ?? ""), conversation: "" };
	}
	return { workspace: "", conversation: "" };
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

/** One picker's whole state: the value, where it came from, and what choosing does. */
export interface ChoicePicker {
	value: string;
	origin?: string | undefined;
	note?: string | undefined;
	groups: PickerGroup[];
	disabled?: boolean | undefined;
	onSelect: (value: string) => void;
}

export interface Platform {
	ready: boolean;
	/** The stream is following, or trying to be. */
	connection: "live" | "reconnecting";
	/** The last action the server refused, in its own words, until it is dismissed or a later
	 * action succeeds. */
	failure?: string | undefined;
	clearFailure: () => void;
	workerUp: boolean;
	workerError?: string | undefined;
	conversations: ConversationSummary[];
	deleted: ConversationSummary[];
	/** The workspaces, with the one in view marked. */
	workspaces: WorkspaceSummary[];
	selectWorkspace: (name: string) => void;
	/** Where the active workspace's tools actually run. */
	sandbox?: SandboxSummary | undefined;
	/** What the defaults resolve to, and the layer each came from. */
	defaults: {
		model: string;
		thinking: string;
		agent: string;
		modelOrigin?: string | undefined;
		thinkingOrigin?: string | undefined;
		agentOrigin?: string | undefined;
	};
	/** Set a default, in this workspace or everywhere. */
	setDefault: (kind: "model" | "thinking" | "agent", scope: DefaultScope, value: string) => void;
	/** The active workspace's image and network. */
	setWorkspace: (change: { image: string; network: string }) => void;
	createWorkspace: (name: string) => void;
	removeWorkspace: (name: string) => void;
	entries: TranscriptEntry[];
	active?: ConversationSummary | undefined;
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
	resolved?: WireResolvedAgent | undefined;
	harness?: string | undefined;
	/** The level that was asked for when the model could not express it. */
	thinkingRequested?: string | undefined;
	/** The inspector's own state, kept the way the rail's is. */
	inspectorOpen: string[];
	setInspectorOpen: (open: string[]) => void;
	inspectorMaximized?: string | undefined;
	setInspectorMaximized: (key: string | undefined) => void;
	railWidth?: number | undefined;
	railOpen: boolean;
	/** The desktop column: false keeps it open, which is the default. */
	railCollapsed: boolean;
	toggleRail: () => void;
	theme: "light" | "dark";
	select: (id: string) => void;
	rename: (id: string, title: string) => void;
	hide: (id: string, hidden: boolean) => void;
	fork: (at: string) => void;
	send: (text: string, whenBusy: BusyAction) => Promise<void>;
	abort: () => void;
	setRailWidth: (width: number) => void;
	setRailOpen: (open: boolean) => void;
	toggleTheme: () => void;
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
	const [seen, setSeen] = useState<Record<string, string>>(() => read(SEEN_KEY, {}));
	const [railWidth, setRailWidthState] = useState<number | undefined>(
		() => read<number | null>(RAIL_WIDTH_KEY, null) ?? undefined,
	);
	const [railOpen, setRailOpen] = useState(false);
	const [railCollapsed, setRailCollapsed] = useState<boolean>(() =>
		read(RAIL_COLLAPSED_KEY, false),
	);
	const [inspectorOpen, setInspectorOpenState] = useState<string[]>(() =>
		read(INSPECTOR_OPEN_KEY, []),
	);
	const [inspectorMaximized, setInspectorMaximizedState] = useState<string | undefined>(
		() => read<string | null>(INSPECTOR_MAXIMIZED_KEY, null) ?? undefined,
	);
	const [system, setSystem] = useState<"light" | "dark">(systemTheme);
	const [choice, setChoice] = useState<"light" | "dark" | null>(storedTheme);
	const theme = choice ?? system;
	const [connection, setConnection] = useState<"live" | "reconnecting">("live");
	const [failure, setFailure] = useState<string | undefined>(undefined);
	const [commands, setCommands] = useState<SlashCommand[]>([]);
	const [ready, setReady] = useState(false);

	const reportError = useCallback((cause: unknown): void => {
		setFailure(cause instanceof Error ? cause.message : String(cause));
	}, []);

	const clearFailure = useCallback((): void => setFailure(undefined), []);

	const workspace = route.workspace === "" ? "general" : route.workspace;
	const activeId =
		route.conversation === "" ? (state?.conversation?.id ?? "") : route.conversation;

	useEffect(() => {
		const back = (): void => setRoute(fromUrl());
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
				if (!cancelled) setState(next);
			},
			onView: (nextView, nextSenders) => {
				if (cancelled) return;
				setView(nextView);
				setSenders(nextSenders);
			},
			onReconnecting: () => {
				if (!cancelled) setConnection("reconnecting");
			},
		});

		return () => {
			cancelled = true;
			source.close();
		};
	}, [workspace, route.conversation]);

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
		if (choice === null) window.localStorage.removeItem(THEME_KEY);
		else window.localStorage.setItem(THEME_KEY, JSON.stringify(choice));
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
				),
		[state, activeId, seen],
	);

	const contextFold = useMemo(() => foldContext(view?.entries ?? []), [view]);

	const workspaces = useMemo(
		() => toWorkspaces(state?.workspaces ?? [], state?.workspace.name ?? ""),
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
				),
		[state, activeId, seen],
	);
	const entries = useMemo(() => toTranscript(view, senders), [view, senders]);
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
	const effectiveModel =
		state === undefined ? "" : `${state.agent.provider}/${state.agent.modelId}`;
	const thinkingLevels =
		modelChoices.find((choice) => choice.value === effectiveModel)?.thinkingLevels ?? [];
	const thinkingValue = state?.agent.thinkingLevel ?? "";
	const agentValue =
		state?.resolved?.name ??
		(state?.agent.definition !== undefined && state.agent.definition !== ""
			? state.agent.definition
			: (state?.defaultAgent ?? ""));

	/** Every picker can go back to inheriting: a choice has to be undoable. */
	const withDefault = (groups: PickerGroup[]): PickerGroup[] => [
		...groups,
		{ options: [{ value: "", label: "Use the default" }] },
	];

	const model: ChoicePicker = {
		value:
			modelChoices.find((choice) => choice.value === effectiveModel)?.label ??
			state?.agent.modelId ??
			"",
		origin:
			state === undefined
				? undefined
				: !state.inherited.model
					? "this conversation"
					: (state.resolved?.model ?? "") !== ""
						? "the agent definition"
						: originLabel(state.defaultsOrigin.model),
		groups: withDefault(toModelGroups(state?.providers ?? [])),
		disabled: activeId === "" || modelChoices.length === 0,
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
		origin:
			state === undefined
				? undefined
				: !state.inherited.thinking
					? "this conversation"
					: (state.resolved?.thinking ?? "") !== ""
						? "the agent definition"
						: originLabel(state.defaultsOrigin.thinking),
		note:
			state !== undefined &&
			(state.agent.thinkingRequested ?? "") !== "" &&
			state.agent.thinkingRequested !== thinkingValue
				? `${state.agent.thinkingRequested ?? ""} was asked`
				: undefined,
		groups: withDefault(toThinkingGroups(thinkingLevels)),
		disabled: activeId === "" || (thinkingLevels.length === 0 && thinkingValue === ""),
		onSelect: (value) => choose({ thinkingLevel: value }),
	};

	const agent: ChoicePicker = {
		value: agentValue,
		origin:
			state === undefined
				? undefined
				: !state.inherited.agent
					? "this conversation"
					: originLabel(state.defaultsOrigin.agent),
		groups: withDefault(toAgentGroups(state?.agents ?? [])),
		disabled: activeId === "",
		onSelect: (value) => choose({ definition: value }),
	};

	const select = useCallback(
		(id: string) => {
			const name = state?.workspace.name ?? workspace;
			window.history.pushState(
				null,
				"",
				`/c/${encodeURIComponent(name)}/${encodeURIComponent(id)}`,
			);
			setRailOpen(false);
			setRoute({ workspace: name, conversation: id });
		},
		[state, workspace],
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
	const send = useCallback(
		async (text: string, whenBusy: BusyAction): Promise<void> => {
			try {
				await sendMessage(workspace, activeId, text, whenBusy);
				setFailure(undefined);
			} catch (cause) {
				// The caller restores the draft; the failure is also the strip's to show.
				reportError(cause);
				throw cause;
			}
		},
		[workspace, activeId, reportError],
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

	const setInspectorOpen = useCallback((open: string[]) => {
		setInspectorOpenState(open);
		window.localStorage.setItem(INSPECTOR_OPEN_KEY, JSON.stringify(open));
	}, []);

	const setInspectorMaximized = useCallback((key: string | undefined) => {
		setInspectorMaximizedState(key);
		if (key === undefined) window.localStorage.removeItem(INSPECTOR_MAXIMIZED_KEY);
		else window.localStorage.setItem(INSPECTOR_MAXIMIZED_KEY, JSON.stringify(key));
	}, []);

	/** A conversation belongs to a workspace for life, so switching means starting over: the
	 * transcript is cleared and the next one arrives with the workspace. */
	const selectWorkspace = useCallback((name: string) => {
		window.history.pushState(null, "", `/w/${encodeURIComponent(name)}`);
		setRailOpen(false);
		setView(undefined);
		setRoute({ workspace: name, conversation: "" });
	}, []);

	const setWorkspace = useCallback(
		(change: { image: string; network: string }) => {
			act(updateWorkspace(workspace, change), () => void reload());
		},
		[act, workspace, reload],
	);

	const createWorkspace = useCallback(
		(name: string) => {
			act(createWorkspaceRequest(name), () => void reload());
		},
		[act, reload],
	);

	const removeWorkspace = useCallback(
		(name: string) => {
			act(removeWorkspaceRequest(name), () => void reload());
		},
		[act, reload],
	);

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
			model:
				state === undefined
					? ""
					: `${state.defaultModel.provider}/${state.defaultModel.modelId}`,
			thinking: state?.defaultThinking ?? "",
			agent: state?.defaultAgent ?? "",
			modelOrigin: originLabel(state?.defaultsOrigin.model),
			thinkingOrigin: originLabel(state?.defaultsOrigin.thinking),
			agentOrigin: originLabel(state?.defaultsOrigin.agent),
		}),
		[state],
	);

	return {
		ready,
		connection,
		failure,
		clearFailure,
		conversations,
		deleted,
		entries,
		active:
			active === undefined ? undefined : toConversation(active, activeId, seen[active.id]),
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
		setWorkspace,
		createWorkspace,
		removeWorkspace,
		usage: lastUsage(view?.entries ?? []),
		resolved: state?.resolved,
		thinkingRequested: state?.agent.thinkingRequested,
		harness: state?.harness,
		inspectorOpen,
		setInspectorOpen,
		inspectorMaximized,
		setInspectorMaximized,
		railWidth,
		railOpen,
		railCollapsed,
		toggleRail,
		theme,
		select,
		rename,
		hide,
		fork,
		send,
		abort,
		setRailWidth,
		setRailOpen,
		toggleTheme: () => setChoice(theme === "dark" ? "light" : "dark"),
	};
}
