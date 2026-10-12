import { StatusDot } from "@/components/ui/status-dot";
import { Text } from "@/components/typography/text";
import { cn } from "cn";

export interface MockRailRowProps {
	title: string;
	/** The row's second line: spend first, then when the conversation last moved. */
	meta: string;
	running?: boolean | undefined;
	/** A run that stopped moving: the dot drops the accent instead of claiming life. */
	stale?: boolean | undefined;
	unread?: boolean | undefined;
	active?: boolean | undefined;
	/** Seconds ago is the useful shape on a phone too, so the line is one step, not a hover. */
	className?: string | undefined;
}

/**
 * The rail row, with the panel's change: spend and when it last moved sit on the row's second
 * line instead of in the `title` tooltip, and a run that stopped moving keeps its dot but loses
 * the accent. The finding is J1/J6 in `docs/ui-workflow/refactor-ux/04-panel-journeys.md`:
 * "cost" is in the recognise step, and a phone has no hover.
 *
 * The formatter for "last moved" is step 09 work; this mock takes the label as a prop so the
 * shape is judged, not the wording.
 */
export function MockRailRow({
	title,
	meta,
	running = false,
	stale = false,
	unread = false,
	active = false,
	className,
}: MockRailRowProps) {
	return (
		<div
			data-slot="mock-rail-row"
			className={cn(
				"relative flex items-start gap-2 rounded-md px-2 py-1.5",
				active ? "bg-primary-subtle" : "hover:bg-accent",
				className,
			)}
		>
			{active ? (
				<span
					aria-hidden
					className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary"
				/>
			) : null}
			<span className="flex w-4 shrink-0 items-center justify-center pt-1">
				{running ? (
					<StatusDot
						state="running"
						size="sm"
						className={stale ? "bg-muted-foreground animate-none" : undefined}
					/>
				) : unread ? (
					<StatusDot state="unread" size="sm" />
				) : null}
			</span>
			<span className="min-w-0 flex-1">
				<Text
					as="span"
					size="sm"
					weight={active ? "semibold" : "normal"}
					className="block truncate"
					dir="auto"
				>
					{title}
				</Text>
				<Text
					as="span"
					size="2xs"
					tone="muted"
					className="block truncate font-mono tabular-nums"
				>
					{meta}
				</Text>
			</span>
		</div>
	);
}
