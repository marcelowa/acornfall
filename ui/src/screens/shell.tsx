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
	/** Full-width row above everything: brand plus title. Stays put on mobile and
	 * desktop, rail open or not. When set, `bar` and `header` are ignored. */
	topbar?: ReactNode | undefined;
	/** Below the transcript. A screen that is not a conversation has no composer, so this is
	 * the one slot that can be absent. */
	composer?: ReactNode | undefined;
	/** The small-screen bar's content, beside the rail toggle. The conversation title, usually. */
	bar?: ReactNode | undefined;
	/** The desktop row above the transcript. A screen that is not a conversation has no title, so this is absent there too. */
	header?: ReactNode | undefined;
	/** A third column where the screen has room. Absent below 2xl and whenever it is not asked for. */
	inspector?: ReactNode | undefined;
	/** Above everything in the main pane: the last refused action, usually. It sits here rather
	 * than in the composer so a screen that is not a conversation still shows it. */
	notice?: ReactNode | undefined;
	railOpen?: boolean | undefined;
	inlineRailToggle?: boolean | undefined;
	onRailOpenChange?: ((open: boolean) => void) | undefined;
	/** A layer the app opens of its own (the workspaces list) beside the rail's: the bar's toggle
	 * is the one close, so it has to know that something other than the rail is in front. */
	appLayerOpen?: boolean | undefined;
	onAppLayerClose?: (() => void) | undefined;
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
	topbar,
	bar,
	header,
	inspector,
	notice,
	railOpen,
	inlineRailToggle,
	onRailOpenChange,
	appLayerOpen,
	onAppLayerClose,
	railCollapsed,
	onRailCollapsedChange,
	railWidth,
	onRailWidthChange,
}: ShellProps) {
	return (
		<Page>
			<Split
				aside={rail}
				topbar={topbar}
				bar={bar}
				header={header}
				inspector={inspector}
				asideOpen={railOpen}
				onAsideOpenChange={onRailOpenChange}
				appLayerOpen={appLayerOpen}
				onAppLayerClose={onAppLayerClose}
				inlineAsideToggle={inlineRailToggle}
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
