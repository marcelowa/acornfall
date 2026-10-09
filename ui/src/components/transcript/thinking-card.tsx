import { useState } from "react";
import { Brain } from "lucide-react";
import type { ThinkingEntry } from "@/app/view-models";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Text } from "@/components/typography/text";
import { cn } from "cn";
import { PaneFooter } from "./pane-footer";

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
	const [expanded, setExpanded] = useState(defaultExpanded ?? open);
	const lines = entry.text === "" ? 0 : entry.text.split("\n").length;
	// Same rule as a tool card: short reasoning stays open with no button, because a
	// put-away control for two visible lines is noise, not power.
	const collapsible = lines > 10 || entry.text.length > 2000;

	return (
		<div
			data-slot="thinking-card"
			data-live={open ? "true" : undefined}
			className="rounded-lg border border-border bg-card"
		>
			<div className="flex items-center gap-2 border-b border-border px-3 py-2">
				<Brain aria-hidden className="size-3.5 text-muted-foreground" />
				<Text as="span" size="sm" weight="semibold">
					Thinking
				</Text>
				<Text as="span" size="2xs" className="ml-auto tabular-nums text-muted-foreground">
					{open ? "live" : `${lines} lines`}
				</Text>
			</div>
			<div
				className={cn(
					"overflow-y-hidden px-3 py-2",
					collapsible && !expanded && "max-h-(--thinking-card-collapsed-height)",
				)}
			>
				<Text as="div" size="sm" className="whitespace-pre-wrap">
					{entry.text}
				</Text>
			</div>
			<PaneFooter at={entry.at} className="px-3 pb-2">
					{!collapsible || open ? null : (
					<Button type="button" variant="ghost" size="xs" onClick={() => setExpanded((value) => !value)}>
						{expanded ? "Show less" : `Show thinking (${lines} lines)`}
					</Button>
					)}
				<CopyButton value={entry.text} />
			</PaneFooter>
		</div>
	);
}
