import type { ReactNode } from "react";
import { Stack } from "@/components/layout/stack";
import { Text } from "@/components/typography/text";

/**
 * A titled group of settings, and one labelled setting inside it. Extracted in step 07 of the
 * refactor-ux chain: five places had each grown their own copy of the same four lines for a
 * group, and four more for a field, which is where the "one commit moment per settings page"
 * change would otherwise have to be made four times.
 *
 * Nothing here decides pixels: the group is a stack of 4px gaps, the title is `sm` semibold, the
 * label is `2xs` muted. A page composes these and decides nothing about appearance.
 */
export interface SettingsGroupProps {
	/** The slot the browser suite reads, when the page has one. */
	slot?: string | undefined;
	title: string;
	/** One line under the title: what the group is for, or when it takes effect. */
	intro?: ReactNode | undefined;
	children: ReactNode;
}

export function SettingsGroup({ slot, title, intro, children }: SettingsGroupProps) {
	return (
		<Stack gap="sm" data-slot={slot}>
			<Text size="sm" weight="semibold">
				{title}
			</Text>
			{intro}
			{children}
		</Stack>
	);
}

export interface SettingsFieldProps {
	/** The label above the control, in the interface's lower-case voice. */
	label: string;
	children: ReactNode;
}

export function SettingsField({ label, children }: SettingsFieldProps) {
	return (
		<Stack gap="2xs">
			<Text size="2xs" tone="muted">
				{label}
			</Text>
			{children}
		</Stack>
	);
}
