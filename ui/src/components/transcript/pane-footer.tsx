import type { ReactNode } from "react";
import { Stack } from "@/components/layout/stack";
import { Text } from "@/components/typography/text";
import { cn } from "cn";

const time = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
const dateTime = new Intl.DateTimeFormat(undefined, {
	month: "short",
	day: "numeric",
	hour: "2-digit",
	minute: "2-digit",
});

export function formatAt(at: Date): string {
	const today = new Date().toDateString() === at.toDateString();
	return today ? time.format(at) : dateTime.format(at);
}

export interface PaneFooterProps {
	at?: Date | undefined;
	className?: string | undefined;
	children?: ReactNode | undefined;
}

/** Every pane ends the same way: when it happened on the left, controls on the right. */
export function PaneFooter({ at, className, children }: PaneFooterProps) {
	return (
		<Stack
			direction="horizontal"
			align="center"
			justify="between"
			gap="sm"
			className={cn("pt-1", className)}
		>
			<Text as="span" size="2xs" tone="muted" className="tabular-nums">
				{at === undefined ? "" : formatAt(at)}
			</Text>
			{children === undefined ? null : (
				<Stack direction="horizontal" align="center" gap="2xs">
					{children}
				</Stack>
			)}
		</Stack>
	);
}
