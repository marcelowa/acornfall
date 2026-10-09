import { useState } from "react";
import type { ToolEntry } from "@/app/view-models";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Text } from "@/components/typography/text";
import { stripAnsi } from "@/lib/text";
import { cn } from "cn";
import { PaneFooter } from "./pane-footer";

/**
 * A completed card longer than this many lines — or this many characters — starts
 * collapsed: the header already says what ran, and the footer says how much is waiting.
 * The character rule catches the one-line dump that line counting cannot see.
 */
const COLLAPSE_AFTER_LINES = 10;
const COLLAPSE_AFTER_CHARS = 2000;

export interface ToolCardProps {
	entry: ToolEntry;
	/** Start expanded; stories use it to show the open form of a long card. */
	defaultExpanded?: boolean | undefined;
}

/**
 * A tool call and its output. The card is a surface of its own — arguments first, output
 * after — and it never loses the output: a long completed card collapses to the token
 * height with an explicit expand, while running and error cards stay fully open.
 */
export function ToolCard({ entry, defaultExpanded = false }: ToolCardProps) {
	const body = [
		entry.args === undefined ? "" : `$ ${JSON.stringify(entry.args, null, 2)}`,
		entry.output === "" ? "" : `\n${stripAnsi(entry.output)}`,
	]
		.join("")
		.trim();
	const status = entry.isError ? "error" : entry.status;
	const lineCount = body === "" ? 0 : body.split("\n").length;
	const collapsible =
		status === "done" &&
		(lineCount > COLLAPSE_AFTER_LINES || body.length > COLLAPSE_AFTER_CHARS);

	// Only a completed card with room to spare collapses: what is still running, or failed,
	// is what the reader is here for.
	const [expanded, setExpanded] = useState(defaultExpanded);
	const clamped = collapsible && !expanded;

	return (
		<div
			data-slot="tool"
			data-status={status}
			className="rounded-lg border border-border bg-card"
		>
			<div className="flex items-center gap-2 border-b border-border px-3 py-2">
				<Text as="span" size="sm" weight="semibold" className="font-mono">
					{entry.name}
				</Text>
				<Text
					as="span"
					size="2xs"
					className={cn(
						"ml-auto font-mono tabular-nums",
						status === "error"
							? "text-destructive"
							: status === "running"
								? "text-primary"
								: "text-muted-foreground",
					)}
				>
					{status}
				</Text>
			</div>
			{body === "" ? null : (
				<pre
					className={cn(
						"overflow-x-auto overflow-y-hidden px-3 py-2 font-mono text-xs whitespace-pre-wrap wrap-anywhere text-foreground tabular-nums",
						clamped && "max-h-(--tool-card-collapsed-height)",
					)}
				>
					{body}
				</pre>
			)}
			<PaneFooter at={entry.at} className="px-3 pb-2">
				{collapsible ? (
					<Button
						type="button"
						variant="ghost"
						size="xs"
						onClick={() => setExpanded((value) => !value)}
					>
						{expanded ? "Show less" : `Show output (${lineCount} lines)`}
					</Button>
				) : null}
				{body === "" ? null : <CopyButton value={body} />}
			</PaneFooter>
		</div>
	);
}
