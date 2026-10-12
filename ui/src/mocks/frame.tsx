import type { CSSProperties, ReactNode } from "react";
import { Stack } from "@/components/layout/stack";
import { Text } from "@/components/typography/text";

/**
 * The frame a mock sits in. Every mock says what it argues for and which panel finding it
 * answers, so a reviewer opening the catalogue sees the decision and not just a picture.
 *
 * Nothing here is part of the product: `ui/src/mocks/` exists for step 06 of the refactor-ux
 * chain and is deleted in step 09, once each approved direction is real.
 */
const widths = {
	rail: "w-[var(--rail-width)]",
	phone: "w-full max-w-sm",
	pane: "w-full max-w-2xl",
} as const;

export interface MockFrameProps {
	/** The direction being proposed, in one line. */
	label: string;
	/** The finding it answers, and where it came from. */
	note: string;
	width?: keyof typeof widths | undefined;
	/** Token overrides, for a mock that has to show a proposed scale inside a fixed theme. */
	style?: CSSProperties | undefined;
	children: ReactNode;
}

export function MockFrame({ label, note, width = "pane", style, children }: MockFrameProps) {
	return (
		<Stack gap="sm" className={widths[width]} style={style}>
			<Stack gap="2xs">
				<Text as="p" size="sm" weight="semibold">
					{label}
				</Text>
				<Text as="p" size="2xs" tone="muted">
					{note}
				</Text>
			</Stack>
			<div className="rounded-lg border border-border bg-card p-3">{children}</div>
		</Stack>
	);
}
