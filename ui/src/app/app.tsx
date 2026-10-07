import { useState } from "react";
import { ConversationList } from "@/components/conversation/conversation-list";
import { Measure } from "@/components/layout/measure";
import { Stack } from "@/components/layout/stack";
import { Transcript } from "@/components/transcript/transcript";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ThemeToggle } from "@/components/ui/theme-toggle";
import { Text } from "@/components/typography/text";
import { Shell } from "@/screens/shell";
import { usePlatform } from "./use-platform";

/**
 * The app: the platform hook's view models and callbacks applied to the dumb screen. This is
 * the only component that renders the Shell, and the composer here is deliberately minimal —
 * #12 rebuilds it with attachments, steering, and the pickers.
 */
export function App() {
	const platform = usePlatform();
	const [draft, setDraft] = useState("");

	const submit = (): void => {
		const text = draft.trim();
		if (text === "" || platform.active === undefined) return;
		platform.send(text);
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

	const composer = (
		<div className="w-full border-t border-border">
			<Measure size="wide" padding="md">
				<Stack direction="horizontal" gap="sm" align="end">
					<Textarea
						value={draft}
						onChange={(event) => setDraft(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && !event.shiftKey) {
								event.preventDefault();
								submit();
							}
						}}
						disabled={platform.active === undefined}
						placeholder={
							platform.active === undefined ? "Pick a conversation" : "Send a message"
						}
					/>
					{platform.active?.running === true ? (
						<Button variant="outline" onClick={platform.abort}>
							Stop
						</Button>
					) : (
						<Button
							onClick={submit}
							disabled={platform.active === undefined || draft.trim() === ""}
						>
							Send
						</Button>
					)}
					<ThemeToggle theme={platform.theme} onToggle={platform.toggleTheme} />
				</Stack>
			</Measure>
		</div>
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
			composer={composer}
		/>
	);
}
