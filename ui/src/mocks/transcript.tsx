import { Brain } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Text } from "@/components/typography/text";
import { PaneFooter } from "@/components/transcript/pane-footer";
import { cn } from "cn";

export interface MockCommittedMessageProps {
	text: string;
	at: Date;
	/** How the message landed: part of the live turn, or waiting behind it. */
	action: "steer" | "followUp";
}

/**
 * A committed message that keeps the mark it was sent with. The finding (all three personas,
 * J4): the label lives on the dashed pending card and dies when the message commits, so nothing
 * afterwards says whether the model got it now or later.
 */
export function MockCommittedMessage({ text, at, action }: MockCommittedMessageProps) {
	return (
		<div className="flex w-fit max-w-full flex-col self-end rounded-lg bg-secondary px-4 py-3">
			<Text as="div" size="lg" dir="auto" className="whitespace-pre-wrap">
				{text}
			</Text>
			<PaneFooter at={at}>
				<Text as="span" size="2xs" tone="muted">
					{action === "steer" ? "steered this turn" : "queued behind the turn"}
				</Text>
			</PaneFooter>
		</div>
	);
}

export interface MockEnterChoiceProps {
	/** How the composer answers the question "what does Enter do while a run is live?". */
	option: "hint" | "newline";
}

/**
 * The Enter question, shown as the two shapes it could take. Today Enter sends as steer while a
 * run is live and nothing says so (verified, `composer.tsx:154` → `sendText("steer")`), and two
 * shipped docs still claim Enter is always a newline. The owner chose the hint; the newline
 * option stays here as the rejected alternative.
 */
export function MockEnterChoice({ option }: MockEnterChoiceProps) {
	return (
		<div className="flex flex-col gap-2 rounded-lg border border-border bg-card p-3">
			<Text as="p" size="sm" tone="muted">
				Change the rail sort to date
			</Text>
			<div className="flex flex-wrap items-center gap-2">
				<Button type="button" variant="destructive" size="sm">
					Stop
				</Button>
				<Button type="button" size="sm">
					Steer
				</Button>
				<Button type="button" variant="secondary" size="sm">
					Queue
				</Button>
				<Text
					as="span"
					size="2xs"
					tone="muted"
					className={cn("w-full", option === "hint" && "font-mono")}
				>
					{option === "hint"
						? "Enter steers · Shift+Enter is a newline"
						: "Enter is a newline while a run is live · Steer sends"}
				</Text>
			</div>
		</div>
	);
}

export interface MockToolCardHeaderProps {
	name: string;
	lines: string[];
	/** The control in the header, where the reader is, instead of under a long output. */
	expanded: boolean;
	/** A settled call whose output was open while it ran, and stays open. */
	settled: boolean;
	/** How a folded card reads: today's 200px window, or the owner's two-line peek. */
	fold?: "window" | "peek" | undefined;
}

/**
 * The tool card with two changes from the panel: Show output / Show less moves into the header
 * (it sits in the footer today, under the output, so closing a 300-line card means scrolling
 * past it), and output that was open while a call ran stays open when the call settles.
 *
 * `fold="peek"` is the owner's review note: a folded card shows its first two lines rather than
 * a 200px window, so the answer keeps its place in the turn and the count on the control says
 * what is being skipped.
 */
export function MockToolCardHeader({
	name,
	lines,
	expanded,
	settled,
	fold = "window",
}: MockToolCardHeaderProps) {
	const body = lines.join("\n");
	return (
		<div className="rounded-lg border border-border bg-card">
			<div className="flex items-center gap-2 border-b border-border px-3 py-2">
				<Text as="span" size="sm" weight="semibold" className="font-mono">
					{name}
				</Text>
				<Button type="button" variant="ghost" size="xs" className="ml-auto">
					{expanded ? "Show less" : `Show output (${lines.length} lines)`}
				</Button>
				<Text as="span" size="2xs" className="font-mono tabular-nums text-muted-foreground">
					{settled ? "done" : "running"}
				</Text>
			</div>
			{expanded ? (
				<pre className="overflow-x-auto overflow-y-hidden px-3 py-2 font-mono text-xs whitespace-pre-wrap wrap-anywhere text-foreground tabular-nums">
					{body}
				</pre>
			) : (
				<pre
					className={cn(
						"overflow-hidden px-3 py-2 font-mono text-xs whitespace-pre-wrap wrap-anywhere text-foreground tabular-nums",
						fold === "peek" ? "line-clamp-2" : "max-h-(--tool-card-collapsed-height)",
					)}
				>
					{body}
				</pre>
			)}
			<PaneFooter at={new Date(Date.now() - 7 * 60_000)} className="px-3 pb-2" />
		</div>
	);
}

export interface MockThinkingCardProps {
	text: string;
	/** The control in the header, as on the tool card. */
	expanded: boolean;
	/** A settled call: the card is no longer live. */
	settled: boolean;
	/** Today's 120px window, or the owner's two-line peek. */
	fold?: "window" | "peek" | undefined;
}

/**
 * The thinking card with the same two changes the tool card gets: the control moves into the
 * header, and reasoning that was open while the model was thinking stays open when it settles.
 * The remount is the same bug — the live entry is keyed `live-thinking` (`app/map.ts:412`) and
 * the committed one by the wire entry id, so `useState(defaultExpanded)` runs again.
 *
 * `fold="peek"` folds reasoning to its first two lines: it is the longest text in a turn and the
 * least often re-read.
 */
export function MockThinkingCard({
	text,
	expanded,
	settled,
	fold = "window",
}: MockThinkingCardProps) {
	const lines = text === "" ? 0 : text.split("\n").length;
	return (
		<div className="rounded-lg border border-border bg-card">
			<div className="flex items-center gap-2 border-b border-border px-3 py-2">
				<Brain aria-hidden className="size-3.5 text-muted-foreground" />
				<Text as="span" size="sm" weight="semibold">
					Thinking
				</Text>
				<Button type="button" variant="ghost" size="xs" className="ml-auto">
					{expanded ? "Show less" : `Show thinking (${lines} lines)`}
				</Button>
				<Text as="span" size="2xs" className="tabular-nums text-muted-foreground">
					{settled ? `${lines} lines` : "live"}
				</Text>
			</div>
			<div
				className={cn(
					"overflow-hidden px-3 py-2",
					!expanded &&
						(fold === "peek"
							? "line-clamp-2"
							: "max-h-(--thinking-card-collapsed-height)"),
				)}
			>
				<Text as="div" size="sm" dir="auto" className="whitespace-pre-wrap">
					{text}
				</Text>
			</div>
			<PaneFooter at={new Date(Date.now() - 9 * 60_000)} className="px-3 pb-2" />
		</div>
	);
}
