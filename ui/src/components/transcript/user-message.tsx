import type { UserEntry } from "@/app/view-models";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Text } from "@/components/typography/text";
import { Markdown } from "./markdown";
import { PaneFooter } from "./pane-footer";

export interface UserMessageProps {
	entry: UserEntry;
	onOpenConversation?: ((id: string) => void) | undefined;
	onFork?: ((at: string) => void) | undefined;
}

/**
 * Your own words are shown exactly as typed. When the entry is another conversation's words —
 * a peer or a subagent asking or reporting — rendering it as your bubble would attribute it
 * to you, so it says who sent it and opens the sender instead.
 */
export function UserMessage({ entry, onOpenConversation, onFork }: UserMessageProps) {
	if (entry.sender !== undefined) {
		const { sender } = entry;
		const who = `${sender.name === undefined ? "" : `${sender.name} · `}conversation ${sender.conversationId}`;
		// The prefix the sender wrote is for the model; showing it to a person is noise.
		const body = entry.text.replace(/^\[from (conversation \d+|subagent [^\]]+)\]\s*/, "");
		return (
			<div data-slot="user" className="rounded-lg border border-border bg-card px-4 py-3">
				<Text as="div" size="2xs" tone="muted" className="pb-1">
					{who} {sender.kind === "report" ? "reported" : "asked"}
				</Text>
				<Markdown>{body}</Markdown>
				<PaneFooter at={entry.at}>
					<Button
						type="button"
						variant="ghost"
						size="xs"
						onClick={() => onOpenConversation?.(sender.conversationId)}
					>
						Open {sender.conversationId}
					</Button>
					<CopyButton value={entry.text} />
				</PaneFooter>
			</div>
		);
	}

	const forkAt = entry.forkAt;
	return (
		<div
			data-slot="user"
			className="flex w-fit max-w-full flex-col self-end rounded-lg bg-secondary px-4 py-3"
		>
			<Text as="div" size="lg" dir="auto" className="whitespace-pre-wrap">
				{entry.text}
			</Text>
			<PaneFooter at={entry.at}>
				{forkAt === undefined ? null : (
					<Button
						type="button"
						variant="ghost"
						size="xs"
						onClick={() => onFork?.(forkAt)}
					>
						Branch
					</Button>
				)}
				<CopyButton value={entry.text} />
			</PaneFooter>
		</div>
	);
}
