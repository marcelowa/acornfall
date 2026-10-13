import { Brain } from "lucide-react";
import type { ThinkingEntry } from "@/app/view-models";
import { CopyButton } from "@/components/ui/copy-button";
import { Text } from "@/components/typography/text";
import { cn } from "cn";
import { PaneCard } from "./pane-card";
import { ThinkingDots } from "./thinking-dots";

export interface ThinkingCardProps {
	entry: ThinkingEntry;
	/** Start expanded; a live card always starts open. */
	defaultExpanded?: boolean | undefined;
}

/**
 * The model's reasoning, when the provider shared it. Same rules as a tool card: the
 * active one stays open, a finished one starts collapsed with its length on the button,
 * and the text is never lost — only put away.
 */
export function ThinkingCard({ entry, defaultExpanded }: ThinkingCardProps) {
	const open = entry.live === true;
	const lines = entry.text === "" ? 0 : entry.text.split("\n").length;
	// Same rule as a tool card: short reasoning stays open with no button, because a
	// put-away control for two visible lines is noise, not power.
	const collapsible = lines > 10 || entry.text.length > 2000;

	return (
		<PaneCard
			slot="thinking-card"
			live={open}
			leading={<Brain aria-hidden className="size-3.5 text-muted-foreground" />}
			title={
				<Text as="span" size="sm" weight="semibold">
					Thinking
				</Text>
			}
			// The count belongs to the fold button, so a settled card does not print it twice.
			aside={
				open ? (
					<Text as="span" size="2xs" className="tabular-nums text-muted-foreground">
						live
					</Text>
				) : undefined
			}
			fold={
				collapsible && !open
					? {
							size: "thinking",
							label: (expanded) =>
								expanded ? "Show less" : `Show thinking (${lines} lines)`,
						}
					: undefined
			}
			defaultExpanded={defaultExpanded ?? open}
			below={
				open ? (
					<div className="px-3 pb-2">
						<ThinkingDots />
					</div>
				) : undefined
			}
			at={entry.at}
			trailing={<CopyButton value={entry.text} />}
			body={({ clamp }) => (
				<div className={cn("overflow-y-hidden px-3 py-2", clamp)}>
					<Text
						as="div"
						size="sm"
						dir="auto"
						className="whitespace-pre-wrap wrap-anywhere"
					>
						{entry.text}
					</Text>
				</div>
			)}
		/>
	);
}
