import { useEffect, useRef, useState } from "react";
import { ArrowUp, ChevronsUpDown, PanelLeftClose, PanelRight, Plus, Settings } from "lucide-react";
import type { DefaultScope, ProviderAuthType, UploadedAttachment } from "./client";
import type { ConversationSummary, ProviderSummary } from "./view-models";
import { MAX_ATTACHMENT_BYTES, refuseAttachments } from "@/lib/attachments";
import { ConversationList } from "@/components/conversation/conversation-list";
import { BrandMark } from "@/components/layout/brand-mark";
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
import { UpdateSection } from "@/components/settings/update-section";
import { ProvidersSection } from "@/components/settings/providers-section";
import { ProviderLoginDialog } from "@/components/settings/provider-login-dialog";
import { WorkspacesScreen } from "@/components/workspace/workspaces-screen";
import { Transcript } from "@/components/transcript/transcript";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { RenameDialog } from "@/components/ui/rename-dialog";
import { CompactDialog } from "@/components/ui/compact-dialog";
import { formatContext } from "@/lib/format";
import { StatusDot } from "@/components/ui/status-dot";
import { runState, useNow } from "@/lib/clock";
import { StatusPill } from "@/components/ui/status-pill";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Text } from "@/components/typography/text";
import { Shell } from "@/screens/shell";
import type { Platform } from "./use-platform";

export interface WorkspaceViewProps {
	platform: Platform;
	/** The draft to start with; stories use it to show the composer mid-thought. */
	initialDraft?: string | undefined;
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
/** A file picked in the composer: uploading, stored, or refused with its reason. */
export interface DraftAttachment {
	key: string;
	name: string;
	size: number;
	mime: string;
	status: "uploading" | "ready" | "failed";
	id?: string | undefined;
	error?: string | undefined;
}

export function WorkspaceView({ platform, initialDraft = "" }: WorkspaceViewProps) {
	const [draft, setDraft] = useState(initialDraft);
	const [attachments, setAttachments] = useState<DraftAttachment[]>([]);
	const attachmentKey = useRef(0);
	const [scope, setScope] = useState<DefaultScope>("workspace");
	/** The conversation being renamed, if any: the rail's menu asks, this dialog answers. */
	const [renaming, setRenaming] = useState<ConversationSummary | undefined>(undefined);
	/** The provider being connected: the dialog's method choice, before a flow starts. */
	const [connecting, setConnecting] = useState<ProviderSummary | undefined>(undefined);
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
		setAttachments([]);
		setSlashIndex(0);
	}, [activeId]);

	// Files picked in the composer upload at once: valid ones stage in the
	// workspace's hidden folder, refused ones stay as chips saying why. A chip
	// removed mid-upload is simply gone when its answer lands.
	const chooseFiles = (files: File[]): void => {
		const batchRefusal = refuseAttachments(attachments, files);
		for (const file of files) {
			attachmentKey.current += 1;
			const key = `attachment-${attachmentKey.current}`;
			const refusal =
				file.size > MAX_ATTACHMENT_BYTES ? "one file carries 10 MB at most" : batchRefusal;
			if (refusal !== undefined) {
				const failed: DraftAttachment = {
					key,
					name: file.name === "" ? "file" : file.name,
					size: file.size,
					mime: file.type,
					status: "failed",
					error: refusal,
				};
				setAttachments((current) => [...current, failed]);
				continue;
			}
			const pending: DraftAttachment = {
				key,
				name: file.name === "" ? "file" : file.name,
				size: file.size,
				mime: file.type,
				status: "uploading",
			};
			setAttachments((current) => [...current, pending]);
			void platform.upload(file).then(
				(done: UploadedAttachment) => {
					setAttachments((current) =>
						current.map((entry) =>
							entry.key === key
								? {
										...entry,
										status: "ready" as const,
										id: done.id,
										name: done.name,
										size: done.size,
										mime: done.mime,
									}
								: entry,
						),
					);
				},
				(cause: unknown) => {
					setAttachments((current) =>
						current.map((entry) =>
							entry.key === key
								? {
										...entry,
										status: "failed" as const,
										error:
											cause instanceof Error ? cause.message : String(cause),
									}
								: entry,
						),
					);
				},
			);
		}
	};

	const removeAttachment = (key: string): void => {
		setAttachments((current) => current.filter((entry) => entry.key !== key));
	};
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

	const readyAttachments = attachments.filter(
		(entry) => entry.status === "ready" && entry.id !== undefined,
	);
	const uploadingAttachments = attachments.some((entry) => entry.status === "uploading");

	const sendText = (action: "steer" | "followUp"): void => {
		const text = draft.trim();
		if (text === "" && readyAttachments.length === 0) return;
		if (uploadingAttachments) return;
		if (platform.active === undefined) return;
		const ids = readyAttachments.map((entry) => entry.id as string);
		setDraft("");
		setAttachments([]);
		// A refused send keeps what was typed: the draft comes back if nothing else does.
		// The chips stay either way — staged files survive a refusal to ride the retry.
		void platform.send(text, action, ids.length === 0 ? undefined : ids).catch(() => {
			setDraft((current) => (current === "" ? text : current));
			setAttachments((current) =>
				current.length === 0 ? readyAttachments.map((entry) => ({ ...entry })) : current,
			);
		});
	};

	const submit = (): void => {
		const text = draft.trim();
		if (text === "" && readyAttachments.length === 0) return;
		const first = visibleSlash[clampedSlash];
		if (first !== undefined) {
			setDraft(`/${first.name} `);
			return;
		}
		sendText("steer");
	};

	const activeWorkspace = platform.workspaces.find((workspace) => workspace.active);

	// The brand lives in the top bar, not the rail: the bar spans the full width on
	// mobile and desktop, so the mark stays put whether the rail is open or not.
	// It opens nothing — below `lg` the drawer toggle beside it opens the rail,
	// and the workspace switcher in the rail head is the navigation.
	const brand = (
		<span className="flex shrink-0 items-center gap-2">
			<BrandMark />
			<Text as="span" size="sm" weight="semibold">
				Acornfall
			</Text>
		</span>
	);
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
						size="icon-sm"
						aria-label="Workspaces"
						onClick={() => platform.showScreen("workspaces")}
					>
						<ChevronsUpDown />
					</Button>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
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
						setRenaming(
							platform.conversations.find((conversation) => conversation.id === id),
						)
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

	// Busy is the flag: the gateway owns the rule now — a fresh record, or an accepted
	// prompt the record has not caught up to — so the interface reads it instead of
	// re-deriving it from transcript evidence. The age is the interface's: the same rule the
	// rail uses, so the two dots cannot disagree about whether a run is still happening.
	const busy = running;
	const now = useNow();
	const run = runState(busy, platform.active?.updatedAt, now);
	const topbarTitle =
		platform.screen === "workspaces"
			? "Workspaces"
			: platform.screen === "settings"
				? "Settings"
				: (platform.active?.title ?? "Acornfall");
	const barTitle = (
		<span className="flex min-w-0 items-center gap-2">
			{run !== "idle" && platform.screen === "conversation" ? (
				<StatusDot state={run} />
			) : null}
			<Text as="span" size="sm" weight="medium" className="truncate">
				{topbarTitle}
			</Text>
		</span>
	);

	// The inspector: the answer to "why did it see that", from the fold — one request, what
	// changed since the one before it, and which layer set what.
	const latest = platform.context.at(-1);
	const inspectorSections = [
		{
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
					workspacePath={platform.workspaces.find((workspace) => workspace.active)?.path}
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
					queued={platform.entries.filter((entry) => entry.kind === "pending").length}
					model={platform.model.value}
					thinking={platform.thinking.value}
				/>
			),
		},
	];
	// One toggle in the top bar: the bar is in the DOM on every width, so the
	// inspector stays in reach on a phone without a second twin in a header.
	const inspectorToggle = (
		<Button
			type="button"
			variant="ghost"
			size="icon-sm"
			aria-label="Inspector"
			aria-expanded={inspectorOpen}
			data-slot="inspector-toggle"
			onClick={() => setInspectorOpen((open) => !open)}
		>
			<PanelRight />
		</Button>
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

	// The provider's own count, shared by the composer line and the compact dialog.
	const contextUsed =
		platform.usage === undefined
			? undefined
			: platform.usage.input + (platform.usage.cacheRead ?? 0);
	const contextText =
		contextUsed === undefined ? undefined : formatContext(contextUsed, platform.contextWindow);

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

	// The update screen: one dot, one screen, one click. Runs block it, and the
	// dialog asks: wait for drain, stop and update, or cancel.
	const updates = (
		<UpdateSection
			status={platform.update}
			runsActive={platform.conversations.some((conversation) => conversation.running)}
			applying={platform.applyingUpdate}
			onCheck={platform.checkUpdateNow}
			onRefresh={platform.refreshUpdate}
			onApply={platform.applyUpdateNow}
			onRollback={platform.rollbackUpdateNow}
			onSavePrefs={platform.setUpdatePrefs}
			onLater={() => platform.showScreen("conversation")}
		/>
	);

	// Provider keys are global, so their section never sits under the workspace tabs.
	const providers = (
		<ProvidersSection
			providers={platform.providers}
			onConnect={setConnecting}
			onDisconnect={platform.logoutProvider}
			onRefresh={platform.refreshProviders}
		/>
	);

	const pickMethod = (method: ProviderAuthType): void => {
		if (connecting === undefined) return;
		platform.startLogin(connecting, method);
	};
	const dismissLogin = (abort: boolean): void => {
		setConnecting(undefined);
		if (abort) platform.cancelLogin();
		else platform.closeLogin();
	};

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
				tab={platform.settingsTab}
				onTabChange={platform.showSettingsTab}
				theme={platform.themeChoice}
				onThemeChange={platform.setThemeChoice}
				workspace={activeWorkspace}
				onUpdateWorkspace={platform.setWorkspace}
				defaults={defaults}
				providers={providers}
				updates={updates}
				failure={platform.failure}
				version={platform.update?.current}
				onClose={() => platform.showScreen("conversation")}
			/>
		) : undefined;

	// The full-width bar: the brand, then the active name, then the pane control.
	// No rail buttons here from `lg`: the rail head closes it and the collapsed strip
	// opens it. Below `lg` Split puts the drawer toggle beside the brand.
	// The update dot: one button, count 1, straight to the Updates tab. It sits
	// in the top bar so it shows on every screen, conversation or settings.
	const updateDot =
		platform.update?.available === true ? (
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				aria-label="Update ready"
				onClick={() => platform.showSettingsTab("updates")}
			>
				<ArrowUp />
				<Badge variant="soft" tone="info" size="sm">
					1
				</Badge>
			</Button>
		) : null;

	const topbar = (
		<>
			{brand}
			<div className="flex min-w-0 flex-1 items-center">{barTitle}</div>
			{updateDot}
			{screen === undefined ? inspectorToggle : null}
		</>
	);

	return (
		<>
			<Shell
				rail={rail}
				topbar={topbar}
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
							attachments={attachments}
							onAttachFiles={chooseFiles}
							onRemoveAttachment={removeAttachment}
							onAbort={() => {
								setAborting(true);
								platform.abort();
							}}
							running={busy}
							aborting={aborting}
							focusConversation={platform.active?.id}
							focusToken={platform.composerFocusToken}
							steerable={platform.steerable}
							contextUsed={contextUsed}
							contextWindow={platform.contextWindow}
							onCompact={platform.openCompactDialog}
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
			<CompactDialog
				open={platform.compactOpen}
				preview={platform.compactPreview}
				contextText={contextText}
				onKeep={() => {
					platform.closeCompactDialog();
					platform.compact();
				}}
				onCancel={platform.closeCompactDialog}
			/>
			<ProviderLoginDialog
				pending={platform.authFlow === undefined ? connecting : undefined}
				flow={platform.authFlow}
				onPickMethod={pickMethod}
				onAnswer={platform.answerLoginPrompt}
				onCancel={() => dismissLogin(true)}
				onClose={() => dismissLogin(false)}
				onRetry={() => {
					const provider = platform.authFlow?.provider;
					platform.closeLogin();
					setConnecting(provider);
				}}
			/>
		</>
	);
}
