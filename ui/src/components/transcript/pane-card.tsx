import type { ReactNode } from "react";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { PaneFooter } from "./pane-footer";

/**
 * The folded sizes, in one place: a card names its size, never a class. Dynamic class names are
 * not an option — Tailwind compiles what it can read in the source — so the literal classes live
 * here and the cards pick one by name.
 *
 * Output and reasoning fold to two lines (the owner's review note). It is a height, not a
 * `line-clamp`: `-webkit-box`, which the clamp needs, calls the longest line its minimum width,
 * so a long output stretched the card and scrolled the page sideways on a phone.
 */
const foldHeights = {
	tool: "line-clamp-2",
	thinking: "line-clamp-2",
	summary: "max-h-(--summary-card-collapsed-height) overflow-hidden",
} as const;

export interface PaneFold {
	/** Which folded size this card uses. */
	size: keyof typeof foldHeights;
	/** The toggle's own words: "Show output (12 lines)", "Show summary", "Show less". */
	label: (expanded: boolean) => string;
}

export interface PaneBodyState {
	/** True when the card is put away, so the body should clamp itself. */
	folded: boolean;
	/** The clamp class to put on the element that carries the padding. Empty when open. */
	clamp: string;
}

export interface PaneCardProps {
	/** The `data-slot` the app and the browser suite read. */
	slot: string;
	/** A state worth reading from outside: `running`, `done`, `error`. */
	status?: string | undefined;
	/** A live card, for the tests that wait on one. */
	live?: boolean | undefined;
	/** A leading mark: the thinking card's brain, the summary's archive. */
	leading?: ReactNode | undefined;
	/** What the card is: a tool's name, "Thinking", "Context compacted". */
	title: ReactNode;
	/** The header's right cell: a status word, a line count. */
	aside?: ReactNode | undefined;
	/** Absent means this card never folds — a short note stays open with no button. */
	fold?: PaneFold | undefined;
	/** Open on first render. A live card is open; a finished one is not. */
	defaultExpanded?: boolean | undefined;
	/** Between the body and the footer: a running card's dots. */
	below?: ReactNode | undefined;
	at?: Date | undefined;
	/** The control after the fold button, usually a copy button. */
	trailing?: ReactNode | undefined;
	/** The body, told whether it is folded so it can clamp the element that carries padding. */
	body: (state: PaneBodyState) => ReactNode;
}

/**
 * The shell every transcript card shares: the surface, the header row, the body, the footer and
 * the fold. Extracted in step 07 of the refactor-ux chain, where ToolCard, ThinkingCard and
 * SummaryCard each held their own copy of the same six lines — and the copies had already
 * drifted: the summary folded to `max-h-24`, a spacing step, while its siblings used component
 * tokens for the same decision.
 *
 * This is a structural pass: nothing here changes what a folded or running card looks like.
 * The body is a function rather than children because the fold state lives here and exactly one
 * element — the one with the padding, which differs per card — has to carry the clamp.
 */
export function PaneCard({
	slot,
	status,
	live,
	leading,
	title,
	aside,
	fold,
	defaultExpanded = false,
	below,
	at,
	trailing,
	body,
}: PaneCardProps) {
	const [expanded, setExpanded] = useState(defaultExpanded);
	const folded = fold !== undefined && !expanded;

	return (
		<div
			data-slot={slot}
			data-status={status}
			data-live={live ? "true" : undefined}
			className="rounded-lg border border-border bg-card"
		>
			<div className="flex items-center gap-2 border-b border-border px-3 py-2">
				<span className="flex min-w-0 items-center gap-2">
					{leading}
					{/*
					 * The title is what gives way when the header runs out of room: a flex item defaults to
					 * `min-width: auto`, so a long tool name pushed the fold control and the status out of
					 * the card and scrolled the page on a phone instead of truncating.
					 */}
					<span className="min-w-0 truncate">{title}</span>
				</span>
				<span className="ml-auto flex shrink-0 items-center gap-2">
					{fold === undefined ? null : (
						<Button
							type="button"
							variant="ghost"
							size="xs"
							// A finger is not a pointer: on a coarse one the fold is the only way back into
							// a long output, so it gets a size a thumb can hit.
							className="pointer-coarse:h-8 pointer-coarse:px-3"
							onClick={() => setExpanded((value) => !value)}
						>
							{fold.label(expanded)}
						</Button>
					)}
					{aside}
				</span>
			</div>
			{body({ folded, clamp: folded ? foldHeights[fold.size] : "" })}
			{below === undefined ? null : below}
			<PaneFooter at={at} className="px-3 pb-2">
				{trailing}
			</PaneFooter>
		</div>
	);
}
