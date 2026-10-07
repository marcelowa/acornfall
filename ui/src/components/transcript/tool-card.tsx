import type { ToolEntry } from "@/app/view-models";
import { CopyButton } from "@/components/ui/copy-button";
import { Text } from "@/components/typography/text";
import { stripAnsi } from "@/lib/text";
import { cn } from "cn";
import { PaneFooter } from "./pane-footer";

export interface ToolCardProps {
	entry: ToolEntry;
}

/**
 * A tool call and its output. The card is a surface of its own — arguments first, output
 * after — and it does not clip: the output is what the person came to read.
 */
export function ToolCard({ entry }: ToolCardProps) {
	const body = [
		entry.args === undefined ? "" : `$ ${JSON.stringify(entry.args, null, 2)}`,
		entry.output === "" ? "" : `\n${stripAnsi(entry.output)}`,
	]
		.join("")
		.trim();
	const status = entry.isError ? "error" : entry.status;

	return (
		<div className="rounded-lg border border-border bg-card">
			<div className="flex items-center gap-2 border-b border-border px-3 py-2">
				<Text as="span" size="sm" weight="semibold" className="font-mono">
					{entry.name}
				</Text>
				<Text
					as="span"
					size="2xs"
					className={cn(
						"ml-auto font-mono",
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
				<pre className="overflow-x-auto px-3 py-2 font-mono text-xs whitespace-pre-wrap text-foreground">
					{body}
				</pre>
			)}
			<PaneFooter at={entry.at} className="px-3 pb-2">
				{body === "" ? null : <CopyButton value={body} />}
			</PaneFooter>
		</div>
	);
}
