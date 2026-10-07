import type { ReactNode } from "react";
import { Page } from "@/components/layout/page";
import { Split } from "@/components/layout/split";
import { Stack } from "@/components/layout/stack";

/**
 * The shape of every screen and nothing else: a rail, a transcript, a composer. It has no
 * state, no data, and no classes — the rail and transcript arrive from #11, the composer from
 * #12, and the app applies the logic that fills the slots. Its story renders it with
 * placeholder content; the app renders it with the platform.
 */
export interface ShellProps {
	rail: ReactNode;
	transcript: ReactNode;
	composer: ReactNode;
}

export function Shell({ rail, transcript, composer }: ShellProps) {
	return (
		<Page>
			<Split aside={rail}>
				<Stack gap="none" fill>
					<Stack gap="lg" padding="lg" scroll="vertical" fill>
						{transcript}
					</Stack>
					{composer}
				</Stack>
			</Split>
		</Page>
	);
}
