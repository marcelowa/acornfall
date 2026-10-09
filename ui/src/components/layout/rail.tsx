import type { ReactNode } from "react";
import { cn } from "cn";

/**
 * The rail's three zones: the workspace on top, its conversations scrolling in the middle,
 * and the always-reachable actions pinned at the bottom. The surface is `--rail`, one step
 * below the content, with the right border doing the separation — the rail is chrome, not a
 * card. Rendered in the desktop column and again in the mobile drawer; both forms share this.
 *
 * The head is one quiet row: the workspace title the app passes, and the app's own icon
 * buttons beside it (switch, collapse). The collapse toggle lives here now, not floating
 * over the rail — so there is no notch, and the head aligns with the rows below it.
 */
export interface RailProps {
	/** The mark and name above everything: branding, not navigation. */
	brand?: ReactNode | undefined;
	head: ReactNode;
	/** Icon buttons that belong to the head row: switching and collapsing, usually. */
	headActions?: ReactNode | undefined;
	list: ReactNode;
	foot: ReactNode;
	className?: string | undefined;
}

export function Rail({ brand, head, list, headActions, foot, className }: RailProps) {

	return (
		<div
			data-slot="rail"
			className={cn(
				"flex min-h-0 flex-1 flex-col gap-2 border-r border-border bg-rail p-2",
				className,
			)}
		>
			{brand === undefined ? null : (
				<div data-slot="rail-brand" className="flex shrink-0 items-center px-2">
					{brand}
				</div>
			)}
			<div data-slot="rail-head" className="flex shrink-0 items-center gap-1 px-2">
				<div className="min-w-0 flex-1 pl-6">{head}</div>
				{headActions === undefined ? null : (
					<div className="flex shrink-0 items-center">{headActions}</div>
				)}
			</div>
			<div data-slot="rail-list" className="flex min-h-0 flex-1 flex-col">
				{list}
			</div>
			<div data-slot="rail-foot" className="flex shrink-0 flex-col gap-0.5">
				{foot}
			</div>
		</div>
	);
}
