import { useState } from "react";
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
import { WorkspaceList } from "@/components/workspace/workspace-list";
import { Stack } from "@/components/layout/stack";
import { Picker } from "@/components/composer/picker";
import { SettingsSheet } from "@/components/settings/settings-sheet";
import { Transcript } from "@/components/transcript/transcript";
import { ThemeToggle } from "@/components/ui/theme-toggle";
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

	const rail = (
		<div className="h-full border-r border-border bg-card p-2">
			<Stack gap="sm" fill>
				<WorkspaceList
					workspaces={platform.workspaces}
					onSelect={platform.selectWorkspace}
				/>
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
						if (title !== null && title.trim() !== "")
							platform.rename(id, title.trim());
					}}
					onHide={(id) => platform.hide(id, true)}
					onRestore={(id) => platform.hide(id, false)}
				/>
			</Stack>
		</div>
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
			open={platform.inspectorOpen}
			onOpenChange={platform.setInspectorOpen}
			maximized={platform.inspectorMaximized}
			onMaximizedChange={platform.setInspectorMaximized}
		/>
	);

	return (
		<Shell
			rail={rail}
			bar={barTitle}
			railOpen={platform.railOpen}
			onRailOpenChange={platform.setRailOpen}
			railCollapsed={platform.railCollapsed}
			onRailCollapsedChange={platform.toggleRail}
			railWidth={platform.railWidth}
			onRailWidthChange={platform.setRailWidth}
			inspector={inspector}
			transcript={<Transcript entries={platform.entries} onFork={platform.fork} />}
			composer={
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
						platform.active === undefined ? "Pick a conversation" : "Send a message"
					}
					error={platform.failure}
					onDismissError={platform.clearFailure}
					above={
						slashWord === null ? undefined : (
							<SlashMenu commands={slashMatches} onSelect={setDraft} />
						)
					}
					controls={
						<>
							<Picker
								label="Model"
								value={platform.model.value}
								origin={platform.model.origin}
								groups={platform.model.groups}
								onSelect={platform.model.onSelect}
								disabled={platform.model.disabled}
							/>
							<Picker
								label="Thinking"
								value={platform.thinking.value}
								origin={platform.thinking.origin}
								note={platform.thinking.note}
								groups={platform.thinking.groups}
								onSelect={platform.thinking.onSelect}
								disabled={platform.thinking.disabled}
							/>
							<Picker
								label="Agent"
								value={platform.agent.value}
								origin={platform.agent.origin}
								groups={platform.agent.groups}
								onSelect={platform.agent.onSelect}
								disabled={platform.agent.disabled}
							/>
							<ThemeToggle theme={platform.theme} onToggle={platform.toggleTheme} />
							<SettingsSheet
								workspace={platform.workspaces.find(
									(workspace) => workspace.active,
								)}
								workspaces={platform.workspaces}
								onUpdateWorkspace={platform.setWorkspace}
								onCreateWorkspace={platform.createWorkspace}
								onRemoveWorkspace={platform.removeWorkspace}
								defaults={
									<Stack gap="sm">
										<ToggleGroup
											type="single"
											value={scope}
											onValueChange={(next) => {
												if (next === "workspace" || next === "install")
													setScope(next);
											}}
											variant="outline"
											size="sm"
											spacing={0}
											aria-label="Default scope"
										>
											<ToggleGroupItem value="workspace">
												This workspace
											</ToggleGroupItem>
											<ToggleGroupItem value="install">
												Every workspace
											</ToggleGroupItem>
										</ToggleGroup>
										<Picker
											label="Model"
											value={platform.defaults.model.split("/").at(-1) ?? ""}
											origin={platform.defaults.modelOrigin}
											groups={platform.model.groups}
											onSelect={(value) =>
												platform.setDefault("model", scope, value)
											}
										/>
										<Picker
											label="Thinking"
											value={platform.defaults.thinking}
											origin={platform.defaults.thinkingOrigin}
											groups={platform.thinking.groups}
											onSelect={(value) =>
												platform.setDefault("thinking", scope, value)
											}
										/>
										<Picker
											label="Agent"
											value={platform.defaults.agent}
											origin={platform.defaults.agentOrigin}
											groups={platform.agent.groups}
											onSelect={(value) =>
												platform.setDefault("agent", scope, value)
											}
										/>
									</Stack>
								}
							/>
						</>
					}
				/>
			}
		/>
	);
}
