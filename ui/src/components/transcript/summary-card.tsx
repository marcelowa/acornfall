import { Archive } from "lucide-react";
import type { SummaryEntry } from "@/app/view-models";
import { CopyButton } from "@/components/ui/copy-button";
import { Text } from "@/components/typography/text";
import { cn } from "cn";
import { Markdown } from "./markdown";
import { PaneCard } from "./pane-card";

export interface SummaryCardProps {
	entry: SummaryEntry;
	/** Start open; a fresh compaction starts put away. */
	defaultExpanded?: boolean | undefined;
}

/**
 * The note a compaction left behind. Same rules as a thinking card: the text is
 * never lost, only put away, and a short note stays open with no button.
 */
export function SummaryCard({ entry, defaultExpanded = false }: SummaryCardProps) {
	const collapsible = entry.markdown.length > 500;

	return (
		<PaneCard
			slot="summary-card"
			leading={<Archive aria-hidden className="size-3.5 text-muted-foreground" />}
			title={
				<Text as="span" size="sm" weight="semibold">
					Context compacted
				</Text>
			}
			fold={
				collapsible
					? {
							size: "summary",
							label: (expanded) => (expanded ? "Show less" : "Show summary"),
						}
					: undefined
			}
			defaultExpanded={defaultExpanded}
			at={entry.at}
			trailing={<CopyButton value={entry.markdown} />}
			body={({ clamp }) => (
				<div className={cn("px-3 py-2", clamp)}>
					<Markdown>{entry.markdown}</Markdown>
				</div>
			)}
		/>
	);
}
