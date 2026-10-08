import { useEffect, useState } from "react";
import { ChevronsUpDown, PanelLeftClose, PanelRight, Plus, Settings } from "lucide-react";
import type { DefaultScope } from "./client";
import type { ConversationSummary } from "./view-models";
import { ConversationList } from "@/components/conversation/conversation-list";
import { Composer } from "@/components/composer/composer";
import { SlashMenu } from "@/components/composer/slash-menu";
import { AgentPanel } from "@/components/inspector/agent-panel";
import { ContextPanel } from "@/components/inspector/context-panel";
import { Inspector } from "@/components/inspector/inspector";
import { InspectorPanel } from "@/components/inspector/inspector-panel";
import { RunPanel } from "@/components/inspector/run-panel";
import { SandboxPanel } from "@/components/inspector/sandbox-panel";
import { Stack } from "@/components/layout/stack";
import { Rail } from "@/components/layout/rail";
import { Measure } from "@/components/layout/measure";
import { ErrorStrip } from "@/components/ui/error-strip";
import { ChoiceControl } from "@/components/composer/choice-control";
import { Picker } from "@/components/composer/picker";
import { SettingsScreen } from "@/components/settings/settings-screen";
import { WorkspacesScreen } from "@/components/workspace/workspaces-screen";
import { Transcript } from "@/components/transcript/transcript";
import { Button } from "@/components/ui/button";
import { RenameDialog } from "@/components/ui/rename-dialog";
import { StatusPill } from "@/components/ui/status-pill";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Text } from "@/components/typography/text";
import { Shell } from "@/screens/shell";
import type { Platform } from "./use-platform";

export interface WorkspaceViewProps {
	platform: Platform;
}

/** True at 2xl, where the inspector docks beside the transcript instead of overlaying it. */
function useWide(): boolean {
	const [wide, setWide] = useState(
		() => typeof window !== "undefined" && window.matchMedia("(min-width: 1536px)").matches,
	);
	useEffect(() => {
		const query = window.matchMedia("(min-width: 1536px)");
		const update = (): void => setWide(query.matches);
		update();
		query.addEventListener("change", update);
		return () => query.removeEventListener("change", update);
	}, []);
	return wide;
}

/**
 * The composition, with no data of its own: the platform hook's view models and callbacks
 * applied to the dumb screen. `App` is this plus the hook, and Storybook renders this with
 * literals — which is what keeps the catalogue and the product the same picture.
 *
 * The draft and the busy-action choice are the composer's own state, not the platform's: they
 * exist for one visit to one conversation and nothing else needs them.
 */
export function WorkspaceView({ platform }: WorkspaceViewProps) {
	const [draft, setDraft] = useState("");
	const [scope, setScope] = useState<DefaultScope>("workspace");
	/** The conversation being renamed, if any: the rail's menu asks, this dialog answers. */
	const [renaming, setRenaming] = useState<ConversationSummary | undefined>(undefined);
	/** The inspector, asked or not: a dialog below 2xl, a docked column where it fits. */
	const [inspectorOpen, setInspectorOpen] = useState(false);
	const wide = useWide();

	// A draft that is one slash word is a command being typed: the menu lists what the server
	// knows, Enter completes the word, and the expansion itself happens server-side.
	const slashWord = /^\/(\S*)$/.exec(draft);
	const slashMatches =
		slashWord === null
			? []
			: platform.commands.filter((command) => command.name.startsWith(slashWord[1] ?? ""));
	// Slash keyboard navigation: the arrows move the highlight, Enter picks it, and Escape
	// dismisses the menu for the word being typed — typing on reopens it for the new word.
	const slashKey = slashWord?.[1] ?? null;
	const [slashIndex, setSlashIndex] = useState(0);
	const [slashHiddenFor, setSlashHiddenFor] = useState<string | null>(null);
	// The draft belongs to one visit to one conversation: switching conversations starts a
	// new visit, not a delivery of the old half-thought into the new room.
	const activeId = platform.active?.id;
	useEffect(() => {
		setDraft("");
		setSlashIndex(0);
	}, [activeId]);
	// Stop stays a button and goes quiet while the abort lands: a slow abort invites
	// repeated clicks, and repeated clicks are repeated abort calls. The run ending, a
	// different conversation, or ten seconds clears it — whichever answers first.
	const [aborting, setAborting] = useState(false);
	const running = platform.active?.running === true;
	useEffect(() => {
		if (!running) setAborting(false);
	}, [running, activeId]);
	useEffect(() => {
		if (!aborting) return;
		const timer = window.setTimeout(() => setAborting(false), 10_000);
		return () => window.clearTimeout(timer);
	}, [aborting]);
	useEffect(() => {
		setSlashIndex(0);
	}, [slashKey]);
	const visibleSlash = slashKey !== null && slashHiddenFor !== slashKey ? slashMatches : [];
	const clampedSlash =
		visibleSlash.length === 0 ? 0 : Math.min(slashIndex, visibleSlash.length - 1);

	const sendText = (action: "steer" | "followUp"): void => {
		const text = draft.trim();
		if (text === "") return;
		if (platform.active === undefined) return;
		setDraft("");
		// A refused send keeps what was typed: the draft comes back if nothing else does.
		void platform.send(text, action).catch(() => {
			setDraft((current) => (current === "" ? text : current));
		});
	};

	const submit = (): void => {
		const text = draft.trim();
		if (text === "") return;
		const first = visibleSlash[clampedSlash];
		if (first !== undefined) {
			setDraft(`/${first.name} `);
			return;
		}
		sendText("steer");
	};

	const activeWorkspace = platform.workspaces.find((workspace) => workspace.active);

	// Three zones, one quiet idiom: the workspace as a title row with its icon buttons, the
	// conversations scrolling in the middle, and two sibling rows pinned at the bottom. Nothing
	// in the chrome is saturated or outlined — the rail is navigation, and the active
	// conversation carries the column's only emphasis.
	const rail = (
		<Rail
			head={
				<Text size="sm" weight="semibold" className="truncate">
					{activeWorkspace?.title ?? "Workspaces"}
				</Text>
			}
			headActions={
				<>
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						aria-label="Workspaces"
						onClick={() => platform.showScreen("workspaces")}
					>
						<ChevronsUpDown />
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						className="hidden lg:flex"
						aria-label="Hide the rail"
						onClick={platform.toggleRail}
					>
						<PanelLeftClose />
					</Button>
				</>
			}
			list={
				<ConversationList
					conversations={platform.conversations}
					deleted={platform.deleted}
					activeId={platform.active?.id}
					onSelect={platform.select}
					onRename={(id) =>
						setRenaming(platform.conversations.find((conversation) => conversation.id === id))
					}
					onHide={(id) => platform.hide(id, true)}
					onRestore={(id) => platform.hide(id, false)}
				/>
			}
			foot={
				<>
					<Button
						variant="ghost"
						size="sm"
						className="justify-start"
						aria-label="New conversation"
						onClick={platform.newConversation}
					>
						<Plus />
						New conversation
					</Button>
					<Button
						variant="ghost"
						size="sm"
						className="justify-start"
						aria-label="Settings"
						onClick={() => platform.showScreen("settings")}
					>
						<Settings />
						Settings
					</Button>
				</>
			}
		/>
	);

	const barTitle = (
		<Text as="span" size="sm" weight="medium" className="truncate">
			{platform.active?.title ?? "Acornfall"}
		</Text>
	);

	// The inspector: the answer to "why did it see that", from the fold — one request, what
	// changed since the one before it, and which layer set what.
	const latest = platform.context.at(-1);
	const inspectorSections = ([{
					key: "context",
					title: "Context",
					hint:
						latest === undefined
							? "nothing sent yet"
							: `${latest.sections.size} sections · ${latest.tools.size} tools`,
					body: <ContextPanel requests={platform.context} usage={platform.usage} />,
				},
				{
					key: "agent",
					title: "Agent",
					hint: platform.agent.value,
					body: (
						<AgentPanel
							resolved={platform.resolved}
							model={platform.model.value}
							thinking={platform.thinking.value}
							thinkingRequested={platform.thinkingRequested}
							sandbox={platform.sandbox?.engine}
							harness={platform.harness}
						/>
					),
				},
				{
					key: "sandbox",
					title: "Sandbox",
					hint:
						platform.sandbox === undefined
							? "unknown"
							: `${platform.sandbox.engine} · ${platform.sandbox.status}`,
					body: (
						<SandboxPanel
							sandbox={platform.sandbox}
							workspacePath={
								platform.workspaces.find((workspace) => workspace.active)?.path
							}
						/>
					),
				},
				{
					key: "run",
					title: "Run",
					hint: platform.active?.running === true ? "running" : "idle",
					body: (
						<RunPanel
							running={platform.active?.running === true}
							queued={
								platform.entries.filter((entry) => entry.kind === "pending").length
							}
							model={platform.model.value}
							thinking={platform.thinking.value}
						/>
					),
				}
			]);
	// The toggle exists twice — the desktop header and the small-screen bar, one hidden at
	// any width — because below `lg` the header is not in the DOM at all, and without the bar
	// twin the inspector (and the spend it answers) would be unreachable on a phone.
	const inspectorToggle = (className?: string) => (
		<Button
			type="button"
			variant="ghost"
			size="icon-sm"
			aria-label="Inspector"
			aria-expanded={inspectorOpen}
			data-slot="inspector-toggle"
			className={className}
			onClick={() => setInspectorOpen((open) => !open)}
		>
			<PanelRight />
		</Button>
	);
	const header = (
		<>
			<div className="flex min-w-0 flex-1 items-center">{barTitle}</div>
			{inspectorToggle()}
		</>
	);
	const bar = (
		<>
			<div className="flex min-w-0 flex-1 items-center">{barTitle}</div>
			{inspectorToggle("lg:hidden")}
		</>
	);
	const inspectorDialog = (
		<Inspector
			sections={inspectorSections}
			open={inspectorOpen && !wide}
			onOpenChange={setInspectorOpen}
		/>
	);
	const dockedInspector = inspectorOpen ? (
		<InspectorPanel sections={inspectorSections} />
	) : undefined;

	const scoped = scope === "workspace" ? platform.defaults.workspace : platform.defaults.global;

	const defaults = (
		<Stack gap="sm">
			<ToggleGroup
				type="single"
				value={scope}
				onValueChange={(next) => {
					if (next === "workspace" || next === "install") setScope(next);
				}}
				variant="outline"
				size="sm"
				spacing={0}
				aria-label="Default scope"
			>
				<ToggleGroupItem value="workspace">This workspace</ToggleGroupItem>
				<ToggleGroupItem value="install">Global</ToggleGroupItem>
			</ToggleGroup>
			<Picker
				label="Agent"
				value={scoped.agent}
				placeholder="not set"
				groups={platform.agent.groups}
				onSelect={(value) => platform.setDefault("agent", scope, value)}
			/>
			<Picker
				label="Model"
				value={platform.modelLabel(scoped.model)}
				placeholder="not set"
				groups={platform.model.groups}
				onSelect={(value) => platform.setDefault("model", scope, value)}
			/>
			<Picker
				label="Thinking"
				value={scoped.thinking}
				placeholder="not set"
				groups={platform.thinkingFor(scoped.model)}
				onSelect={(value) => platform.setDefault("thinking", scope, value)}
			/>
		</Stack>
	);

	// The screens replace the conversation rather than sitting over it: they are places, and
	// the rail is how you leave and how you come back.
	const screen =
		platform.screen === "workspaces" ? (
			<WorkspacesScreen
				workspaces={platform.workspaces}
				onSelect={platform.selectWorkspace}
				onCreate={platform.createWorkspace}
				onRename={platform.renameWorkspace}
				onForget={platform.removeWorkspace}
				onClose={() => platform.showScreen("conversation")}
			/>
		) : platform.screen === "settings" ? (
			<SettingsScreen
				theme={platform.themeChoice}
				onThemeChange={platform.setThemeChoice}
				workspace={activeWorkspace}
				onUpdateWorkspace={platform.setWorkspace}
				defaults={defaults}
				onClose={() => platform.showScreen("conversation")}
			/>
		) : undefined;

	return (
		<>
			<Shell
				rail={rail}
				bar={bar}
				header={screen === undefined ? header : undefined}
				inspector={screen === undefined ? dockedInspector : undefined}
				railOpen={platform.railOpen}
				onRailOpenChange={platform.setRailOpen}
				inlineRailToggle
				railCollapsed={platform.railCollapsed}
				onRailCollapsedChange={platform.toggleRail}
				railWidth={platform.railWidth}
				onRailWidthChange={platform.setRailWidth}
				notice={
					platform.failure === undefined ? undefined : (
						<Measure size="wide" padding="md">
							<ErrorStrip
								message={platform.failure}
								onDismiss={platform.clearFailure}
								onRetry={platform.reload}
							/>
						</Measure>
					)
				}
				transcript={
					screen ?? (
						<Transcript
							entries={platform.entries}
							ready={platform.ready}
							onFork={platform.fork}
						/>
					)
				}
				composer={
					screen === undefined ? (
						<Composer
							value={draft}
							onChange={setDraft}
							onSend={submit}
							onAbort={() => {
								setAborting(true);
								platform.abort();
							}}
							running={platform.active?.running === true}
							aborting={aborting}
							focusConversation={platform.active?.id}
							steerable={platform.steerable}
							onSteer={() => sendText("steer")}
							onQueue={() => sendText("followUp")}
							disabled={platform.active === undefined || !platform.workerUp}
							placeholder={
								platform.active === undefined
									? "Pick a conversation"
										: platform.workerUp
											? "Send a message"
											: "The harness is down"
							}
							above={
								visibleSlash.length === 0 ? undefined : (
									<SlashMenu
										commands={visibleSlash}
										highlighted={clampedSlash}
										onHighlight={setSlashIndex}
										onSelect={setDraft}
									/>
								)
							}
							slashCount={visibleSlash.length}
							slashIndex={clampedSlash}
							onSlashIndexChange={setSlashIndex}
							onSlashPick={(index) => {
								const match = visibleSlash[index];
								if (match !== undefined) setDraft(`/${match.name} `);
							}}
							onSlashDismiss={() => setSlashHiddenFor(slashKey)}
							controls={
								<>
									{/* Ambient state first: a dropped stream or a dead harness is the thing to know
									 * before choosing a model. Nothing renders while everything is well. */}
									{platform.workerUp ? (
										platform.connection === "reconnecting" ? (
											<StatusPill state="reconnecting" />
										) : null
									) : (
										<StatusPill
											state="harness-down"
											detail={platform.workerError}
										/>
									)}
									<ChoiceControl
										agent={platform.agent}
										model={platform.model}
										thinking={platform.thinking}
									/>
								</>
							}
						/>
					) : undefined
				}
			/>
			{/* The inspector is about the conversation in front of you, so it is only there
			 * when one is: on a screen, it would be answering a question nobody asked. */}
			{screen === undefined ? inspectorDialog : null}
			<RenameDialog
				open={renaming !== undefined}
				title="Rename conversation"
				initial={renaming?.title ?? ""}
				onSave={(title) => {
					if (renaming !== undefined) platform.rename(renaming.id, title);
					setRenaming(undefined);
				}}
				onCancel={() => setRenaming(undefined)}
			/>
		</>
	);
}
