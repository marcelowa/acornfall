import { useCallback, useEffect, useMemo, useState } from "react";
import {
	abortConversation,
	createConversation as createConversationRequest,
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
	stalePins,
	toAgentGroups,
	toConversation,
	toModelChoices,
	toModelGroups,
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
}

/** The screens the URL can name. A conversation is one of them, because it has a URL too. */
export type Screen = "conversation" | "workspaces" | "settings";

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

/** The URL scheme the gateway routes: /c/<workspace>/<conversation>, /w/<workspace>, and the
 * two screens. Settings remembers the workspace in a query so a reload shows the one it was
 * about; the workspace list is about all of them. */
function fromUrl(): Route {
	const path = window.location.pathname;
	if (path === "/settings" || path === "/settings/") {
		return {
			screen: "settings",
			workspace: new URLSearchParams(window.location.search).get("workspace") ?? "",
			conversation: "",
		};
	}
	if (path === "/workspaces" || path === "/workspaces/") {
		return { screen: "workspaces", workspace: "", conversation: "" };
	}
	const conversation = /^\/c\/([^/]+)\/([^/]+)\/?$/.exec(path);
	if (conversation !== null) {
		return {
			screen: "conversation",
			workspace: decodeURIComponent(conversation[1] ?? ""),
			conversation: decodeURIComponent(conversation[2] ?? ""),
		};
	}
	const workspace = /^\/w\/([^/]+)\/?$/.exec(path);
	if (workspace !== null) {
		return {
			screen: "conversation",
			workspace: decodeURIComponent(workspace[1] ?? ""),
			conversation: "",
		};
	}
	return { screen: "conversation", workspace: "", conversation: "" };
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
	/** The screen in view: a conversation, the workspace list, or settings. */
	screen: Screen;
	showScreen: (screen: Screen) => void;
	/** A conversation belongs to a workspace for life, so switching means starting over: the
	 * transcript is cleared and the next one arrives with the workspace. */
	selectWorkspace: (name: string) => void;
	/** A new conversation in the workspace in view, created and opened. */
	newConversation: () => void;
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
	/** The active workspace's image and network. */
	setWorkspace: (change: { image: string; network: string }) => void;
	createWorkspace: (name: string) => void;
	removeWorkspace: (name: string) => void;
	renameWorkspace: (name: string, title: string) => void;
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
	send: (text: string, whenBusy: BusyAction) => Promise<void>;
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
	const [seen, setSeen] = useState<Record<string, string>>(() => read(SEEN_KEY, {}));
	const [railWidth, setRailWidthState] = useState<number | undefined>(
		() => read<number | null>(RAIL_WIDTH_KEY, null) ?? undefined,
	);
	const [railOpen, setRailOpen] = useState(false);
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
				),
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
				),
		[state, activeId, seen],
	);
	const runningNow =
		(state?.conversations ?? []).find((conversation) => conversation.id === activeId)
			?.running === true;
	const entries = useMemo(
		() => toTranscript(view, senders, runningNow),
		[view, senders, runningNow],
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
			setRoute({ screen: "conversation", workspace: name, conversation: id });
		},
		[state, workspace],
	);

	/** The rail is the way between the screens; each one keeps its own URL so a reload and a
	 * shared link land where someone was. */
	const showScreen = useCallback(
		(screen: Screen) => {
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
				// Settings are about a workspace; the list is about all of them.
				const query =
					screen === "settings" ? `?workspace=${encodeURIComponent(workspace)}` : "";
				window.history.pushState(null, "", `/${screen}${query}`);
			}
			setRailOpen(false);
			// The conversation stays the one behind the screen: the stream keeps following it, so
			// coming back shows what happened while the screen was open.
			setRoute((current) => ({ ...current, screen }));
		},
		[state, workspace, activeId],
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
		setView(undefined);
		setRoute({ screen: "conversation", workspace: name, conversation: "" });
	}, []);

	const setWorkspace = useCallback(
		(change: { image: string; network: string }) => {
			act(updateWorkspace(workspace, change), () => void reload());
		},
		[act, workspace, reload],
	);

	const createWorkspace = useCallback(
		(name: string) => {
			act(createWorkspaceRequest(name), () => {
				// The workspace opens on its first conversation, which the gateway makes for a
				// workspace that has none — so there is nothing to create here, and creating one
				// would leave the new workspace with two.
				window.history.pushState(null, "", `/w/${encodeURIComponent(name)}`);
				setView(undefined);
				setRoute({ screen: "conversation", workspace: name, conversation: "" });
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
					setRoute({ screen: "conversation", workspace: "general", conversation: "" });
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

	const newConversation = useCallback(() => {
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
				setRoute({ screen: "conversation", workspace, conversation: id });
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
		setWorkspace,
		createWorkspace,
		removeWorkspace,
		usage: lastUsage(view?.entries ?? []),
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
		newConversation,
		select,
		rename,
		hide,
		fork,
		send,
		abort,
		setRailWidth,
		setRailOpen,
		renameWorkspace,
	};
}
