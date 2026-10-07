import { useLayoutEffect, useRef } from "react";
import type { TranscriptEntry } from "@/app/view-models";
import { Measure } from "@/components/layout/measure";
import { Stack } from "@/components/layout/stack";
import { Text } from "@/components/typography/text";
import { AssistantMessage } from "./assistant-message";
import { NoticeLine } from "./notice-line";
import { PendingMessage } from "./pending-message";
import { ToolCard } from "./tool-card";
import { UserMessage } from "./user-message";

export interface TranscriptProps {
	entries: TranscriptEntry[];
	onOpenConversation?: ((id: string) => void) | undefined;
	onFork?: ((at: string) => void) | undefined;
}

/**
 * The transcript owns its scrolling, because it is the thing that knows whether it is
 * following the end: it opens there — the answer is what someone came for — keeps following
 * while text arrives, and stops the moment the reader scrolls away. The next conversation
 * starts at its end again.
 */
export function Transcript({ entries, onOpenConversation, onFork }: TranscriptProps) {
	const scroller = useRef<HTMLDivElement>(null);
	const following = useRef(true);

	// The first entry changes when the conversation does; the last entry's shape changes when
	// text arrives, including while it is still being written.
	const conversation = entries[0]?.id ?? "";
	const last = entries.at(-1);
	const dependency = `${entries.length}:${last?.id ?? ""}:${
		last?.kind === "assistant" ? last.markdown.length : 0
	}`;

	useLayoutEffect(() => {
		following.current = true;
	}, [conversation]);

	useLayoutEffect(() => {
		const element = scroller.current;
		if (element === null || !following.current) return;
		element.scrollTop = element.scrollHeight;
	}, [dependency, conversation]);

	return (
		<div
			ref={scroller}
			data-slot="transcript"
			onScroll={() => {
				const element = scroller.current;
				if (element === null) return;
				following.current =
					element.scrollHeight - element.scrollTop - element.clientHeight < 80;
			}}
			className="min-h-0 flex-1 overflow-y-auto [&>*]:shrink-0"
		>
			<Measure size="wide" padding="lg">
				{entries.length === 0 ? (
					<Text tone="muted">No messages yet.</Text>
				) : (
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
								case "pending":
									return <PendingMessage key={entry.id} entry={entry} />;
							}
						})}
					</Stack>
				)}
			</Measure>
		</div>
	);
}
