import { Ellipsis } from "lucide-react";
import type { ConversationSummary } from "@/app/view-models";
import { Button } from "@/components/ui/button";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@/components/ui/context-menu";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { StatusDot } from "@/components/ui/status-dot";
import { useNow } from "@/lib/clock";
import { formatCost, formatMoved, formatTokens } from "@/lib/format";
import { cn } from "cn";

/**
 * A run whose last move is older than this stops claiming to be live in the rail: the dot drops
 * its accent and the row carries the time instead. The gateway's own busy window is half an
 * hour, which is long enough for a run that died to keep a lit dot — the panel's finding — and
 * a shorter window here would dim a genuinely slow tool call, so this matches the window the
 * server itself calls fresh and lets the time on the row do the rest.
 */
const STALE_AFTER_MINUTES = 30;

export interface ConversationRowProps {
	conversation: ConversationSummary;
	active?: boolean | undefined;
	onSelect?: ((id: string) => void) | undefined;
	onRename?: ((id: string) => void) | undefined;
	onHide?: ((id: string) => void) | undefined;
	onRestore?: ((id: string) => void) | undefined;
	className?: string | undefined;
}

interface RowAction {
	label: string;
	destructive: boolean;
	run: () => void;
}

/**
 * One rail row: the live state as a dot in a fixed leading column, then the title, nothing
 * else on the line. The dot sits at the same x on every row, so running and unread align
 * down the rail instead of jittering after variable-width titles; identity (`#3 ·peer`) and
 * spend live in the tooltip, as the old client had them. A 280px rail has room for a title
 * or a column of numbers, not both — and the strongest position in the line belongs to the
 * title, not the metadata.
 *
 * The active row says so three ways at once — the subtle wash, a semibold title, and a
 * brand bar at the left edge — because a wash alone cannot be found at a glance. Hover is
 * the full accent, not a half wash, for the same reason.
 *
 * The actions are a menu, not two buttons waiting on a hover: a hover does not exist on a
 * touch screen, and the second button was a delete sitting one slip away from a rename. The
 * menu opens from the `…` button, from a right-click anywhere on the row, and from a long
 * press on touch, because they are the same question asked three ways.
 *
 * The select target and the row actions are siblings: a button inside a button is not HTML.
 */
export function ConversationRow({
	conversation,
	active = false,
	onSelect,
	onRename,
	onHide,
	onRestore,
	className,
}: ConversationRowProps) {
	// The age and the stale rule are decisions about now, and the row is the only thing on
	// screen that changes while nothing else does.
	const now = useNow();
	const tags = [
		conversation.root ? "root" : null,
		conversation.createdBy === undefined ? null : "peer",
	].filter((tag) => tag !== null);
	// Identity and spend are tooltip-only: the line keeps the title.
	const title = [
		`#${conversation.id}${tags.length === 0 ? "" : ` ·${tags.join(" ·")}`}`,
		conversation.createdBy === undefined
			? ""
			: `created by conversation ${conversation.createdBy}`,
		conversation.tokens > 0
			? `${formatTokens(conversation.tokens)}${
					conversation.cost > 0 ? ` · ${formatCost(conversation.cost)}` : ""
				}`
			: "",
	]
		.filter((part) => part !== "")
		.join(" · ");

	// Spend and when it last moved, on the row. Both were tooltip-only (the panel's finding: a
	// phone has no hover, and a value you must hover to compare cannot be compared). The tooltip
	// keeps the id and the sender, which are not worth a line.
	const meta = [
		conversation.tokens > 0 ? formatTokens(conversation.tokens) : "",
		conversation.cost > 0 ? formatCost(conversation.cost) : "",
		formatMoved(conversation.updatedAt, now),
	]
		.filter((part) => part !== "")
		.join(" · ");
	const stale =
		conversation.running &&
		conversation.updatedAt !== undefined &&
		now.getTime() - conversation.updatedAt.getTime() > STALE_AFTER_MINUTES * 60_000;

	const actions: RowAction[] = conversation.hidden
		? [{ label: "Restore", destructive: false, run: () => onRestore?.(conversation.id) }]
		: [
				{ label: "Rename", destructive: false, run: () => onRename?.(conversation.id) },
				{ label: "Delete", destructive: true, run: () => onHide?.(conversation.id) },
			];

	const row = (
		<div
			data-slot="conversation-row"
			data-id={conversation.id}
			data-active={active}
			className={cn(
				"group relative flex items-center gap-1 rounded-md px-2 py-1.5",
				active ? "bg-primary-subtle hover:bg-primary-subtle" : "hover:bg-accent",
				className,
			)}
		>
			{active ? (
				<span
					aria-hidden
					className="absolute inset-y-1.5 left-0 w-0.5 rounded-full bg-primary"
				/>
			) : null}
			<button
				type="button"
				data-slot="conversation-select"
				data-conversation={conversation.id}
				onClick={() => onSelect?.(conversation.id)}
				aria-current={active ? "true" : undefined}
				title={title === "" ? undefined : title}
				className="rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 flex min-w-0 flex-1 items-start gap-2 text-start"
			>
				<span className="flex w-4 shrink-0 items-center justify-center pt-1">
					{conversation.running ? (
						<StatusDot
							state="running"
							className={stale ? "animate-none bg-muted-foreground" : undefined}
						/>
					) : conversation.unread ? (
						<StatusDot state="unread" />
					) : null}
				</span>
				<span className="min-w-0 flex-1">
					<span
						dir="auto"
						className={cn(
							"block truncate text-sm",
							conversation.hidden
								? "text-muted-foreground line-through"
								: "text-foreground",
							active && "font-semibold",
						)}
					>
						{conversation.title}
					</span>
					{meta === "" ? null : (
						<span className="block truncate font-mono text-2xs text-muted-foreground tabular-nums">
							{meta}
						</span>
					)}
				</span>
			</button>
			<span className="flex shrink-0 items-center opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 pointer-coarse:opacity-100">
				<DropdownMenu>
					<DropdownMenuTrigger asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							aria-label={`Actions for ${conversation.title}`}
						>
							<Ellipsis />
						</Button>
					</DropdownMenuTrigger>
					<DropdownMenuContent align="end">
						{actions.map((action) => (
							<DropdownMenuItem
								key={action.label}
								variant={action.destructive ? "destructive" : "default"}
								onSelect={action.run}
							>
								{action.label}
							</DropdownMenuItem>
						))}
					</DropdownMenuContent>
				</DropdownMenu>
			</span>
		</div>
	);

	return (
		<ContextMenu>
			<ContextMenuTrigger asChild>{row}</ContextMenuTrigger>
			<ContextMenuContent>
				{actions.map((action) => (
					<ContextMenuItem
						key={action.label}
						variant={action.destructive ? "destructive" : "default"}
						onSelect={action.run}
					>
						{action.label}
					</ContextMenuItem>
				))}
			</ContextMenuContent>
		</ContextMenu>
	);
}
