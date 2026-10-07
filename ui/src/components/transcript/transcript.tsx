import type { TranscriptEntry } from "@/app/view-models";
import { Stack } from "@/components/layout/stack";
import { Text } from "@/components/typography/text";
import { AssistantMessage } from "./assistant-message";
import { NoticeLine } from "./notice-line";
import { ToolCard } from "./tool-card";
import { UserMessage } from "./user-message";

export interface TranscriptProps {
	entries: TranscriptEntry[];
	onOpenConversation?: ((id: string) => void) | undefined;
	onFork?: ((at: string) => void) | undefined;
}

export function Transcript({ entries, onOpenConversation, onFork }: TranscriptProps) {
	if (entries.length === 0) {
		return <Text tone="muted">No messages yet.</Text>;
	}

	return (
		<Stack gap="xl">
			{entries.map((entry) => {
				switch (entry.kind) {
					case "user":
						return (
							<UserMessage
								key={entry.id}
								entry={entry}
								onOpenConversation={onOpenConversation}
								onFork={onFork}
							/>
						);
					case "assistant":
						return <AssistantMessage key={entry.id} entry={entry} />;
					case "tool":
						return <ToolCard key={entry.id} entry={entry} />;
					case "notice":
						return <NoticeLine key={entry.id} entry={entry} />;
				}
			})}
		</Stack>
	);
}
