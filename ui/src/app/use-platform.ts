import { useCallback, useEffect, useMemo, useState } from "react";
import {
	abortConversation,
	fetchState,
	forkConversation,
	hideConversation,
	openStream,
	renameConversation,
	sendMessage,
} from "./client";
import { toConversation, toTranscript } from "./map";
import type { ConversationSummary, TranscriptEntry } from "./view-models";
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

export interface Platform {
	ready: boolean;
	error?: string | undefined;
	conversations: ConversationSummary[];
	deleted: ConversationSummary[];
	entries: TranscriptEntry[];
	active?: ConversationSummary | undefined;
	workerUp: boolean;
	railWidth?: number | undefined;
	railOpen: boolean;
	theme: "light" | "dark";
	select: (id: string) => void;
	rename: (id: string, title: string) => void;
	hide: (id: string, hidden: boolean) => void;
	fork: (at: string) => void;
	send: (text: string) => void;
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
	const [ready, setReady] = useState(false);

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

	const reportError = useCallback((cause: unknown): void => {
		setError(cause instanceof Error ? cause.message : String(cause));
	}, []);

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
		(text: string) => {
			const busy = active?.running === true;
			void sendMessage(workspace, activeId, text, busy ? "steer" : "followUp").catch(
				reportError,
			);
		},
		[workspace, activeId, active, reportError],
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
