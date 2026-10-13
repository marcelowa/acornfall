import type { ReactNode } from "react";
import { Stack } from "@/components/layout/stack";
import { Text } from "@/components/typography/text";

/**
 * The frame a mock sits in: what it argues for, the journey it answers, and the finding behind
 * it, so a reviewer opening the catalogue sees the decision and not just a picture.
 *
 * Nothing here is part of the product: `ui/src/mocks/` exists for the mock step of the
 * refactor-ux chain and is deleted in the build step, once each approved direction is real.
 */
const widths = {
	pane: "w-full max-w-2xl",
	dialog: "w-full max-w-md",
	phone: "w-full max-w-sm",
} as const;

export interface MockFrameProps {
	/** The direction being proposed, in one line. */
	label: string;
	/** The journey it answers, and what it costs. */
	note: string;
	width?: keyof typeof widths | undefined;
	children: ReactNode;
}

export function MockFrame({ label, note, width = "pane", children }: MockFrameProps) {
	return (
		<Stack gap="sm" className={widths[width]}>
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
