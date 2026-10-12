import { useLayoutEffect, useRef, useState } from "react";
import { ArrowDown } from "lucide-react";
import type { TranscriptEntry } from "@/app/view-models";
import { Measure } from "@/components/layout/measure";
import { Stack } from "@/components/layout/stack";
import { Heading } from "@/components/typography/heading";
import { Text } from "@/components/typography/text";
import { Button } from "@/components/ui/button";
import { Kbd } from "@/components/ui/kbd";
import { groupTurns } from "@/lib/turns";
import { AssistantMessage } from "./assistant-message";
import { NoticeLine } from "./notice-line";
import { SummaryCard } from "./summary-card";
import { PendingMessage } from "./pending-message";
import { ToolCard } from "./tool-card";
import { ThinkingCard } from "./thinking-card";
import { UserMessage } from "./user-message";

export interface TranscriptProps {
	entries: TranscriptEntry[];
	/**
	 * The first load has not landed: the transcript shows a loading line, not the empty
	 * state — inviting someone to start a conversation over content about to arrive is a
	 * lie the slow network tells.
	 */
	ready?: boolean | undefined;
	onOpenConversation?: ((id: string) => void) | undefined;
	onFork?: ((at: string) => void) | undefined;
}

/**
 * What React keys a card by, and so what decides whether a card keeps the fold a reader opened.
 * A tool call has the same provider id while it runs and after it settles, so the card is the
 * same card across that boundary; every other entry is keyed by its own id.
 */
function entryKey(entry: TranscriptEntry): string {
	return entry.kind === "tool" && entry.callId !== undefined ? `tool-${entry.callId}` : entry.id;
}

function Entry({
	entry,
	onOpenConversation,
	onFork,
}: {
	entry: TranscriptEntry;
	onOpenConversation?: ((id: string) => void) | undefined;
	onFork?: ((at: string) => void) | undefined;
}) {
	switch (entry.kind) {
		case "user":
			return (
				<UserMessage
					entry={entry}
					onOpenConversation={onOpenConversation}
					onFork={onFork}
				/>
			);
		case "assistant":
			return <AssistantMessage key={entry.id} entry={entry} />;
		case "tool":
			return <ToolCard key={entryKey(entry)} entry={entry} />;
		case "thinking":
			return <ThinkingCard key={entry.id} entry={entry} />;
		case "notice":
			return <NoticeLine key={entry.id} entry={entry} />;
		case "summary":
			return <SummaryCard key={entry.id} entry={entry} />;
		case "pending":
			return <PendingMessage key={entry.id} entry={entry} />;
	}
}

/**
 * The transcript owns its scrolling, because it is the thing that knows whether it is
 * following the end: it opens there — the answer is what someone came for — keeps following
 * while text arrives, and stops the moment the reader scrolls away. The next conversation
 * starts at its end again.
 *
 * Entries render as turns with two rhythms: tight within a turn, wide between turns. When
 * the reader has scrolled away, a pill offers the way back.
 */
export function Transcript({ entries, ready = true, onOpenConversation, onFork }: TranscriptProps) {
	const scroller = useRef<HTMLDivElement>(null);
	const following = useRef(true);
	const [away, setAway] = useState(false);

	// The first entry changes when the conversation does; the last entry's shape changes
	// while it is still being written — an answer, a thought, a tool's output. Anything
	// growing keeps the view pinned to its end, where the thinking indicator lives.
	const conversation = entries[0]?.id ?? "";
	const last = entries.at(-1);
	const lastText =
		last === undefined
			? ""
			: last.kind === "assistant"
				? last.markdown
				: last.kind === "thinking"
					? last.text
					: last.kind === "tool"
						? last.output
						: last.kind === "summary"
							? last.markdown
							: last.text;
	const dependency = `${entries.length}:${last?.id ?? ""}:${lastText.length}`;

	useLayoutEffect(() => {
		following.current = true;
		setAway(false);
	}, [conversation]);

	useLayoutEffect(() => {
		const element = scroller.current;
		if (element === null || !following.current) return;
		element.scrollTop = element.scrollHeight;
	}, [dependency, conversation]);

	const jumpLatest = (): void => {
		const element = scroller.current;
		if (element === null) return;
		following.current = true;
		setAway(false);
		element.scrollTop = element.scrollHeight;
	};

	const turns = groupTurns(entries);

	return (
		<div data-slot="transcript" className="relative flex min-h-0 flex-1 flex-col">
			<div
				ref={scroller}
				onScroll={() => {
					const element = scroller.current;
					if (element === null) return;
					following.current =
						element.scrollHeight - element.scrollTop - element.clientHeight < 80;
					setAway(!following.current);
				}}
				className="min-h-0 flex-1 overflow-y-auto [&>*]:shrink-0"
			>
				<Measure size="wide" padding="lg">
					{!ready ? (
						<Stack gap="sm" align="center" className="py-16 text-center">
							<Text tone="muted">Loading…</Text>
						</Stack>
					) : entries.length === 0 ? (
						<Stack gap="sm" align="center" className="py-16 text-center">
							<Heading level={2}>Start a conversation</Heading>
							<Text tone="muted">
								Send a message below, or type <Kbd>/</Kbd> for commands.
							</Text>
						</Stack>
					) : (
						<>
							<Stack gap="2xl">
								{turns.map((turn, index) => (
									<Stack key={turn[0]?.id ?? index} gap="lg" data-turn={index}>
										{turn.map((entry) => (
											<Entry
												key={entryKey(entry)}
												entry={entry}
												onOpenConversation={onOpenConversation}
												onFork={onFork}
											/>
										))}
									</Stack>
								))}
							</Stack>
							{/* Air below the indicator: the end of a run should rest above the
							 * composer with room to breathe, not glued to its edge. */}
							<div aria-hidden className="h-8" />
						</>
					)}
				</Measure>
			</div>
			{away && entries.length > 0 ? (
				<Button
					type="button"
					size="sm"
					className="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-full shadow-md"
					onClick={jumpLatest}
				>
					<ArrowDown />
					Latest
				</Button>
			) : null}
		</div>
	);
}
