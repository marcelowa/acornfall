import { useState } from "react";
import type { BusyAction } from "./view-models";
import { ConversationList } from "@/components/conversation/conversation-list";
import { Composer } from "@/components/composer/composer";
import { Picker } from "@/components/composer/picker";
import { SlashMenu } from "@/components/composer/slash-menu";
import { Transcript } from "@/components/transcript/transcript";
import { ThemeToggle } from "@/components/ui/theme-toggle";
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
		platform.send(text, busyAction);
		setDraft("");
	};

	const rail = (
		<div className="h-full border-r border-border bg-card p-2">
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
		</div>
	);

	const barTitle = (
		<Text as="span" size="sm" weight="medium" className="truncate">
			{platform.active?.title ?? "Acornfall"}
		</Text>
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
					disabled={platform.active === undefined}
					placeholder={
						platform.active === undefined ? "Pick a conversation" : "Send a message"
					}
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
						</>
					}
				/>
			}
		/>
	);
}
