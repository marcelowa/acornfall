import { useState } from "react";
import type { BusyAction } from "@/app/view-models";
import { ConversationList } from "@/components/conversation/conversation-list";
import { Composer } from "@/components/composer/composer";
import { Stack } from "@/components/layout/stack";
import { Transcript } from "@/components/transcript/transcript";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Text } from "@/components/typography/text";
import { Shell } from "@/screens/shell";
import { usePlatform } from "./use-platform";

/**
 * The app: the platform hook's view models and callbacks applied to the dumb screen. The
 * composer's controls are the theme toggle for now; the model, thinking, and agent pickers
 * land beside it next.
 */
export function App() {
	const platform = usePlatform();
	const [draft, setDraft] = useState("");
	const [busyAction, setBusyAction] = useState<BusyAction>("steer");

	const submit = (): void => {
		const text = draft.trim();
		if (text === "" || platform.active === undefined) return;
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
					controls={
						<Stack direction="horizontal" gap="2xs" align="center">
							<ThemeToggle theme={platform.theme} onToggle={platform.toggleTheme} />
						</Stack>
					}
				/>
			}
		/>
	);
}
