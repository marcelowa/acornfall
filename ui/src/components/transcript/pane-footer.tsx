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
	/**
	 * A note beside the time — how a message was sent, for instance. It belongs with the when,
	 * not with the controls on the right: put in the controls' group it reads as one of them.
	 */
	note?: ReactNode | undefined;
	className?: string | undefined;
	children?: ReactNode | undefined;
}

/** Every pane ends the same way: when it happened on the left, controls on the right. */
export function PaneFooter({ at, note, className, children }: PaneFooterProps) {
	return (
		<Stack
			direction="horizontal"
			align="center"
			justify="between"
			gap="sm"
			className={cn("pt-1", className)}
		>
			<span className="flex min-w-0 items-center gap-2">
				<Text as="span" size="2xs" tone="muted" className="tabular-nums">
					{at === undefined ? "" : formatAt(at)}
				</Text>
				{note}
			</span>
			{children === undefined ? null : (
				<Stack direction="horizontal" align="center" gap="2xs">
					{children}
				</Stack>
			)}
		</Stack>
	);
}
