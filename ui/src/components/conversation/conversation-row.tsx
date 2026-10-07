import { Pencil, RotateCcw, X } from "lucide-react";
import type { ConversationSummary } from "@/app/view-models";
import { Button } from "@/components/ui/button";
import { StatusDot } from "@/components/ui/status-dot";
import { formatCost, formatTokens } from "@/lib/format";
import { cn } from "cn";

export interface ConversationRowProps {
	conversation: ConversationSummary;
	active?: boolean | undefined;
	onSelect?: ((id: string) => void) | undefined;
	onRename?: ((id: string) => void) | undefined;
	onHide?: ((id: string) => void) | undefined;
	onRestore?: ((id: string) => void) | undefined;
	className?: string | undefined;
}

/**
 * One rail row: the title, live state as a dot, and identity as text — the rule ADR 0009
 * settled, because a second coloured dot would be three meanings for one shape. Identity is
 * the visible metadata (`#3 ·peer`) and spend lives in the tooltip, as the old client had
 * it: a 280px rail has room for a title or a column of numbers, not both. A tombstoned row
 * keeps its place under "Deleted" and offers restore instead of delete.
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
	const tags = [
		conversation.root ? "root" : null,
		conversation.createdBy === undefined ? null : "peer",
	].filter((tag) => tag !== null);
	const identity = `#${conversation.id}${tags.length === 0 ? "" : ` ·${tags.join(" ·")}`}`;
	const spend =
		conversation.tokens > 0
			? `${formatTokens(conversation.tokens)}${
					conversation.cost > 0 ? ` · ${formatCost(conversation.cost)}` : ""
				}`
			: "";
	const title = [
		conversation.createdBy === undefined
			? ""
			: `created by conversation ${conversation.createdBy}`,
		spend,
	]
		.filter((part) => part !== "")
		.join(" · ");

	return (
		<div
			data-active={active}
			className={cn(
				"group flex items-center gap-1 rounded-md px-2 py-1.5",
				active ? "bg-accent" : "hover:bg-accent/50",
				className,
			)}
		>
			<button
				type="button"
				onClick={() => onSelect?.(conversation.id)}
				aria-current={active ? "true" : undefined}
				className="flex min-w-0 flex-1 items-center gap-2 text-left"
			>
				<span
					className={cn(
						"truncate text-sm",
						conversation.hidden
							? "text-muted-foreground line-through"
							: "text-foreground",
					)}
				>
					{conversation.title}
				</span>
				{conversation.running ? (
					<StatusDot state="running" />
				) : conversation.unread ? (
					<StatusDot state="unread" />
				) : null}
				<span
					className="ml-auto flex shrink-0 items-center gap-1 font-mono text-2xs text-muted-foreground"
					title={title === "" ? undefined : title}
				>
					<span>{identity}</span>
				</span>
			</button>
			<span className="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
				{conversation.hidden ? (
					<Button
						type="button"
						variant="ghost"
						size="icon-xs"
						aria-label={`Restore ${conversation.title}`}
						onClick={() => onRestore?.(conversation.id)}
					>
						<RotateCcw />
					</Button>
				) : (
					<>
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							aria-label={`Rename ${conversation.title}`}
							onClick={() => onRename?.(conversation.id)}
						>
							<Pencil />
						</Button>
						<Button
							type="button"
							variant="ghost"
							size="icon-xs"
							aria-label={`Delete ${conversation.title}`}
							onClick={() => onHide?.(conversation.id)}
						>
							<X />
						</Button>
					</>
				)}
			</span>
		</div>
	);
}
