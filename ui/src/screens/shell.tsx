import type { ReactNode } from "react";
import { Page } from "@/components/layout/page";
import { Split } from "@/components/layout/split";
import { Stack } from "@/components/layout/stack";

/**
 * The shape of every screen and nothing else: a rail, a transcript, and a composer. It has no
 * state, no data, and no classes. Each slot owns its own alignment: the transcript centres
 * itself on a readable measure, and the composer is expected to do the same, which is why
 * nothing here wraps them.
 *
 * The rail is a drawer below `lg`, and the app can control it when selecting a conversation
 * should close it.
 */
export interface ShellProps {
	rail: ReactNode;
	transcript: ReactNode;
	/** Below the transcript. A screen that is not a conversation has no composer, so this is
	 * the one slot that can be absent. */
	composer?: ReactNode | undefined;
	/** The small-screen bar's content, beside the rail toggle. The conversation title, usually. */
	bar?: ReactNode | undefined;
	/** Above everything in the main pane: the last refused action, usually. It sits here rather
	 * than in the composer so a screen that is not a conversation still shows it. */
	notice?: ReactNode | undefined;
	railOpen?: boolean | undefined;
	onRailOpenChange?: ((open: boolean) => void) | undefined;
	/** The desktop column: false keeps it open, which is the default. */
	railCollapsed?: boolean | undefined;
	onRailCollapsedChange?: ((collapsed: boolean) => void) | undefined;
	/** Controlled rail width in pixels; the token's 280px when omitted. */
	railWidth?: number | undefined;
	onRailWidthChange?: ((width: number) => void) | undefined;
}

export function Shell({
	rail,
	transcript,
	composer,
	bar,
	notice,
	railOpen,
	onRailOpenChange,
	railCollapsed,
	onRailCollapsedChange,
	railWidth,
	onRailWidthChange,
}: ShellProps) {
	return (
		<Page>
			<Split
				aside={rail}
				bar={bar}
				asideOpen={railOpen}
				onAsideOpenChange={onRailOpenChange}
				asideCollapsed={railCollapsed}
				onAsideCollapsedChange={onRailCollapsedChange}
				asideWidth={railWidth}
				onAsideWidthChange={onRailWidthChange}
			>
				{/* The transcript owns its own scrolling: it knows when it is following the end and
				 * when the reader has scrolled away from it. */}
				<Stack gap="none" fill>
					{notice}
					{transcript}
				</Stack>
				{composer}
			</Split>
		</Page>
	);
}
