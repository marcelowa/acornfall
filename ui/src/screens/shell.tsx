import type { ReactNode } from "react";
import { Page } from "@/components/layout/page";
import { Split } from "@/components/layout/split";
import { Stack } from "@/components/layout/stack";

/**
 * The shape of every screen and nothing else: a rail, a transcript, a composer, and — where
 * the screen is wide enough — the inspector. It has no state, no data, and no classes. Each
 * slot owns its own alignment: the transcript centres itself on a readable measure, and the
 * composer is expected to do the same, which is why nothing here wraps them.
 *
 * The rail is a drawer below `lg`, and the app can control it when selecting a conversation
 * should close it.
 */
export interface ShellProps {
	rail: ReactNode;
	transcript: ReactNode;
	composer: ReactNode;
	/** The context inspector: a pane of its own from 2xl up, where there is room for it. */
	inspector?: ReactNode | undefined;
	/** The small-screen bar's content, beside the rail toggle. The conversation title, usually. */
	bar?: ReactNode | undefined;
	railOpen?: boolean | undefined;
	onRailOpenChange?: ((open: boolean) => void) | undefined;
	/** Controlled rail width in pixels; the token's 280px when omitted. */
	railWidth?: number | undefined;
	onRailWidthChange?: ((width: number) => void) | undefined;
}

export function Shell({
	rail,
	transcript,
	composer,
	inspector,
	bar,
	railOpen,
	onRailOpenChange,
	railWidth,
	onRailWidthChange,
}: ShellProps) {
	return (
		<Page>
			<Split
				aside={rail}
				end={inspector}
				bar={bar}
				asideOpen={railOpen}
				onAsideOpenChange={onRailOpenChange}
				asideWidth={railWidth}
				onAsideWidthChange={onRailWidthChange}
			>
				<Stack gap="none" fill>
					<Stack gap="none" scroll="vertical" fill>
						{transcript}
					</Stack>
					{composer}
				</Stack>
			</Split>
		</Page>
	);
}
