import { useState } from "react";
import { Archive } from "lucide-react";
import type { SummaryEntry } from "@/app/view-models";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Text } from "@/components/typography/text";
import { cn } from "cn";
import { Markdown } from "./markdown";
import { PaneFooter } from "./pane-footer";

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
	const [expanded, setExpanded] = useState(defaultExpanded);
	const collapsible = entry.markdown.length > 500;

	return (
		<div data-slot="summary-card" className="rounded-lg border border-border bg-card">
			<div className="flex items-center gap-2 border-b border-border px-3 py-2">
				<Archive aria-hidden className="size-3.5 text-muted-foreground" />
				<Text as="span" size="sm" weight="semibold">
					Context compacted
				</Text>
			</div>
			<div
				className={cn(
					"px-3 py-2",
					collapsible && !expanded && "max-h-24 overflow-y-hidden",
				)}
			>
				<Markdown>{entry.markdown}</Markdown>
			</div>
			<PaneFooter at={entry.at} className="px-3 pb-2">
				{!collapsible ? null : (
					<Button
						type="button"
						variant="ghost"
						size="xs"
						onClick={() => setExpanded((value) => !value)}
					>
						{expanded ? "Show less" : "Show summary"}
					</Button>
				)}
				<CopyButton value={entry.markdown} />
			</PaneFooter>
		</div>
	);
}
