import { useCallback, useEffect, useMemo, useState } from "react";
import {
	abortConversation,
	fetchCommands,
	fetchState,
	forkConversation,
	hideConversation,
	openStream,
	renameConversation,
	sendMessage,
	setAgent,
	type AgentChange,
} from "./client";
import {
	originLabel,
	toAgentGroups,
	toConversation,
	toModelChoices,
	toModelGroups,
	toThinkingGroups,
	toTranscript,
} from "./map";
import type {
	BusyAction,
	ConversationSummary,
	PickerGroup,
	SlashCommand,
	TranscriptEntry,
} from "./view-models";
import type { WireSender, WireState, WireView } from "./wire";

const RAIL_WIDTH_KEY = "acornfall.ui.railWidth";
const SEEN_KEY = "acornfall.seen";
const THEME_KEY = "acornfall.ui.theme";

interface Route {
	workspace: string;
	conversation: string;
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
	error?: string | undefined;
	conversations: ConversationSummary[];
	deleted: ConversationSummary[];
	entries: TranscriptEntry[];
	active?: ConversationSummary | undefined;
	workerUp: boolean;
	/** The worker can take a steering input mid-turn; without it the choice is stop or queue. */
	steerable: boolean;
	/** Model, thinking, and agent as the conversation resolves them, with their layer. */
	model: ChoicePicker;
	thinking: ChoicePicker;
	agent: ChoicePicker;
	/** The commands the server would expand, for the slash menu. */
	commands: SlashCommand[];
	railWidth?: number | undefined;
	railOpen: boolean;
	theme: "light" | "dark";
	select: (id: string) => void;
	rename: (id: string, title: string) => void;
	hide: (id: string, hidden: boolean) => void;
	fork: (at: string) => void;
	send: (text: string, whenBusy: BusyAction) => void;
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
	const [theme, setTheme] = useState<"light" | "dark">(() =>
		read<"light" | "dark">(THEME_KEY, "light"),
	);
	const [error, setError] = useState<string | undefined>(undefined);
	const [commands, setCommands] = useState<SlashCommand[]>([]);
	const [ready, setReady] = useState(false);

	const reportError = useCallback((cause: unknown): void => {
		setError(cause instanceof Error ? cause.message : String(cause));
	}, []);

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
				setError(undefined);
			} catch (cause) {
				if (!cancelled) setError(cause instanceof Error ? cause.message : String(cause));
			}
		};
		void load();

		const source = openStream(workspace, route.conversation, {
			onOpen: () => undefined,
			onState: (next) => {
				if (!cancelled) setState(next);
			},
			onView: (nextView, nextSenders) => {
				if (cancelled) return;
				setView(nextView);
				setSenders(nextSenders);
			},
			onReconnecting: () => {
				if (!cancelled) setError("reconnecting");
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
			setError(undefined);
		} catch (cause) {
			setError(cause instanceof Error ? cause.message : String(cause));
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

	useEffect(() => {
		document.documentElement.classList.toggle("dark", theme === "dark");
		window.localStorage.setItem(THEME_KEY, JSON.stringify(theme));
	}, [theme]);

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
			void setAgent(workspace, activeId, change).then(setState).catch(reportError);
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

	const rename = useCallback(
		(id: string, title: string) => {
			void renameConversation(workspace, id, title).then(reload).catch(reportError);
		},
		[workspace, reload, reportError],
	);
	const hide = useCallback(
		(id: string, hidden: boolean) => {
			void hideConversation(workspace, id, hidden).then(reload).catch(reportError);
		},
		[workspace, reload, reportError],
	);
	const fork = useCallback(
		(at: string) => {
			void forkConversation(workspace, activeId, at).then(reload).catch(reportError);
		},
		[workspace, activeId, reload, reportError],
	);
	const send = useCallback(
		(text: string, whenBusy: BusyAction) => {
			void sendMessage(workspace, activeId, text, whenBusy).catch(reportError);
		},
		[workspace, activeId, reportError],
	);
	const abort = useCallback(() => {
		void abortConversation(workspace, activeId).catch(reportError);
	}, [workspace, activeId, reportError]);

	const setRailWidth = useCallback((width: number) => {
		setRailWidthState(width);
		window.localStorage.setItem(RAIL_WIDTH_KEY, JSON.stringify(width));
	}, []);

	return {
		ready,
		error,
		conversations,
		deleted,
		entries,
		active:
			active === undefined ? undefined : toConversation(active, activeId, seen[active.id]),
		workerUp: state?.workerUp ?? false,
		steerable: state?.capabilities.steer ?? false,
		model,
		thinking,
		agent,
		commands,
		railWidth,
		railOpen,
		theme,
		select,
		rename,
		hide,
		fork,
		send,
		abort,
		setRailWidth,
		setRailOpen,
		toggleTheme: () => setTheme((current) => (current === "dark" ? "light" : "dark")),
	};
}
