import { useState } from "react";
import { ChevronsUpDown, Plus, Settings } from "lucide-react";
import type { DefaultScope } from "./client";
import type { BusyAction } from "./view-models";
import { ConversationList } from "@/components/conversation/conversation-list";
import { Composer } from "@/components/composer/composer";
import { SlashMenu } from "@/components/composer/slash-menu";
import { AgentPanel } from "@/components/inspector/agent-panel";
import { ContextPanel } from "@/components/inspector/context-panel";
import { Inspector } from "@/components/inspector/inspector";
import { RunPanel } from "@/components/inspector/run-panel";
import { SandboxPanel } from "@/components/inspector/sandbox-panel";
import { Stack } from "@/components/layout/stack";
import { Measure } from "@/components/layout/measure";
import { ErrorStrip } from "@/components/ui/error-strip";
import { ChoiceControl } from "@/components/composer/choice-control";
import { Picker } from "@/components/composer/picker";
import { SettingsScreen } from "@/components/settings/settings-screen";
import { WorkspacesScreen } from "@/components/workspace/workspaces-screen";
import { Transcript } from "@/components/transcript/transcript";
import { Button } from "@/components/ui/button";
import { StatusPill } from "@/components/ui/status-pill";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { Text } from "@/components/typography/text";
import { Shell } from "@/screens/shell";
import type { Platform } from "./use-platform";

export interface WorkspaceViewProps {
	platform: Platform;
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
	const [busyAction, setBusyAction] = useState<BusyAction>("steer");
	const [scope, setScope] = useState<DefaultScope>("workspace");

	// A draft that is one slash word is a command being typed: the menu lists what the server
	// knows, Enter completes the word, and the expansion itself happens server-side.
	const slashWord = /^\/(\S*)$/.exec(draft);
	const slashMatches =
		slashWord === null
			? []
			: platform.commands.filter((command) => command.name.startsWith(slashWord[1] ?? ""));

	const submit = (): void => {
		const text = draft.trim();
		if (text === "") return;
		const first = slashMatches[0];
		if (first !== undefined) {
			setDraft(`/${first.name} `);
			return;
		}
		if (platform.active === undefined) return;
		setDraft("");
		// A refused send keeps what was typed: the draft comes back if nothing else does.
		void platform.send(text, busyAction).catch(() => {
			setDraft((current) => (current === "" ? text : current));
		});
	};

	const activeWorkspace = platform.workspaces.find((workspace) => workspace.active);

	// Three zones: the workspace on top, its conversations scrolling in the middle, and the two
	// things that are always worth reaching at the bottom.
	// Three zones: the workspace on top, its conversations scrolling in the middle, and the two
	// things that are always worth reaching pinned at the bottom. The stack is what bounds the
	// middle zone — a rail that is not a flex column has nothing to scroll inside, and a long
	// list pushes the bottom out of the pane.
	const rail = (
		<Stack gap="sm" fill className="border-r border-border bg-card p-2">
			{/* The rail's own toggle floats in the top-right corner, so the top zone stops short of
			 * it: the button's chevron belongs beside its own border, not under a control that is
			 * not part of it. */}
			<Stack gap="none" className="shrink-0 pr-8">
				<Button
					// Outlined rather than bare: it opens a screen, and nothing about a line of text
					// with a chevron after it says that out loud.
					variant="outline"
					size="sm"
					className="w-full justify-between"
					aria-label="Workspaces"
					onClick={() => platform.showScreen("workspaces")}
				>
					<span className="truncate">{activeWorkspace?.title ?? "Workspaces"}</span>
					<ChevronsUpDown />
				</Button>
			</Stack>
			<ConversationList
				conversations={platform.conversations}
				deleted={platform.deleted}
				activeId={platform.active?.id}
				onSelect={platform.select}
				onRename={(id) => {
					const current = platform.conversations.find(
						(conversation) => conversation.id === id,
					);
					const title = window.prompt("Rename conversation", current?.title ?? "");
					if (title !== null && title.trim() !== "") platform.rename(id, title.trim());
				}}
				onHide={(id) => platform.hide(id, true)}
				onRestore={(id) => platform.hide(id, false)}
			/>
			<Stack gap="2xs" className="shrink-0">
				<Button size="sm" aria-label="New conversation" onClick={platform.newConversation}>
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
			</Stack>
		</Stack>
	);

	const barTitle = (
		<Text as="span" size="sm" weight="medium" className="truncate">
			{platform.active?.title ?? "Acornfall"}
		</Text>
	);

	// The inspector: the answer to "why did it see that", from the fold — one request, what
	// changed since the one before it, and which layer set what.
	const latest = platform.context.at(-1);
	const inspector = (
		<Inspector
			sections={[
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
				},
			]}
		/>
	);

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
				<ToggleGroupItem value="install">Every workspace</ToggleGroupItem>
			</ToggleGroup>
			<Picker
				label="Model"
				value={platform.defaults.model.split("/").at(-1) ?? ""}
				origin={platform.defaults.modelOrigin}
				groups={platform.model.groups}
				onSelect={(value) => platform.setDefault("model", scope, value)}
			/>
			<Picker
				label="Thinking"
				value={platform.defaults.thinking}
				origin={platform.defaults.thinkingOrigin}
				groups={platform.thinking.groups}
				onSelect={(value) => platform.setDefault("thinking", scope, value)}
			/>
			<Picker
				label="Agent"
				value={platform.defaults.agent}
				placeholder="built in"
				origin={platform.defaults.agentOrigin}
				groups={platform.agent.groups}
				onSelect={(value) => platform.setDefault("agent", scope, value)}
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
				bar={barTitle}
				railOpen={platform.railOpen}
				onRailOpenChange={platform.setRailOpen}
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
							/>
						</Measure>
					)
				}
				transcript={
					screen ?? <Transcript entries={platform.entries} onFork={platform.fork} />
				}
				composer={
					screen === undefined ? (
						<Composer
							value={draft}
							onChange={setDraft}
							onSend={submit}
							onAbort={platform.abort}
							running={platform.active?.running === true}
							steerable={platform.steerable}
							busyAction={busyAction}
							onBusyActionChange={setBusyAction}
							disabled={platform.active === undefined || !platform.workerUp}
							placeholder={
								platform.active === undefined
									? "Pick a conversation"
									: "Send a message"
							}
							above={
								slashWord === null ? undefined : (
									<SlashMenu commands={slashMatches} onSelect={setDraft} />
								)
							}
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
			{inspector}
		</>
	);
}
