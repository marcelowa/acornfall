import type { PendingEntry } from "@/app/view-models";
import { CopyButton } from "@/components/ui/copy-button";
import { Text } from "@/components/typography/text";
import { cn } from "cn";
import { PaneFooter } from "./pane-footer";

export interface PendingMessageProps {
	entry: PendingEntry;
	className?: string | undefined;
}

/**
 * Sent, accepted, and not committed yet: a steered message is part of the turn that is
 * running, a follow-up waits behind it. It looks unfinished on purpose — dashed, muted,
 * labelled — because it is, and because the alternative is a message that disappears until
 * the server decides what to do with it.
 */
export function PendingMessage({ entry, className }: PendingMessageProps) {
	return (
		<div
			data-slot="pending"
			data-action={entry.action}
			className={cn(
				"flex w-fit max-w-full flex-col self-end rounded-lg border border-dashed border-border bg-muted/50 px-4 py-3",
				className,
			)}
		>
			<Text as="div" size="lg" dir="auto" className="whitespace-pre-wrap">
				{entry.text}
			</Text>
			<PaneFooter>
				<Text as="span" size="2xs" tone="muted">
					{entry.action === "steer" ? "steering this turn" : "queued behind this turn"}
				</Text>
				<CopyButton value={entry.text} />
			</PaneFooter>
		</div>
	);
}
