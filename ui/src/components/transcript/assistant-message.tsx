import { useState } from "react";
import type { AssistantEntry } from "@/app/view-models";
import { Button } from "@/components/ui/button";
import { CopyButton } from "@/components/ui/copy-button";
import { Text } from "@/components/typography/text";
import { Markdown } from "./markdown";
import { PaneFooter } from "./pane-footer";
import { ThinkingDots } from "./thinking-dots";

export interface AssistantMessageProps {
	entry: AssistantEntry;
	/** Start in the raw view; the toggle is per pane, which is a reading decision about one reply. */
	defaultRaw?: boolean;
}

export function AssistantMessage({ entry, defaultRaw = false }: AssistantMessageProps) {
	const [raw, setRaw] = useState(defaultRaw);

	// A provider failure is an entry with no content; the failure text is the only explanation
	// the reader gets, so it is the pane.
	if (entry.failure !== undefined) {
		return (
			<div
				data-slot="assistant"
				data-error="true"
				className="rounded-lg border border-destructive/40 bg-destructive-subtle px-4 py-3"
			>
				<Text as="div" size="sm" className="text-destructive-subtle-foreground">
					{entry.failure}
				</Text>
				<PaneFooter at={entry.at} />
			</div>
		);
	}

	// While the text is still arriving it has no controls: it is incomplete, and the pane gets
	// them the moment it is committed. The dots are the promise that something is coming:
	// without them a thinking model with no output yet renders as nothing at all.
	if (entry.live === true) {
		return (
			<div data-slot="assistant" data-live="true" className="w-full">
				{entry.markdown === "" ? null : <Markdown streaming>{entry.markdown}</Markdown>}
				<div data-slot="thinking" className="py-2">
					<ThinkingDots label="Responding" />
				</div>
			</div>
		);
	}

	return (
		<div data-slot="assistant" className="w-full">
			{raw ? (
				<Text as="div" size="lg" className="whitespace-pre-wrap wrap-anywhere">
					{entry.markdown}
				</Text>
			) : (
				<Markdown>{entry.markdown}</Markdown>
			)}
			<PaneFooter at={entry.at}>
				<Button
					type="button"
					variant="ghost"
					size="xs"
					aria-pressed={raw}
					onClick={() => setRaw((value) => !value)}
				>
					{raw ? "Formatted" : "Raw"}
				</Button>
				{/* Copy takes the markdown source, not the rendered text: pasting markup into a
				 * document is more useful than pasting flattened prose. */}
				<CopyButton value={entry.markdown} />
			</PaneFooter>
		</div>
	);
}
