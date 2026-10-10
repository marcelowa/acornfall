import { useState } from "react";
import { ChevronRight } from "lucide-react";
import type { ConversationSummary } from "@/app/view-models";
import { Text } from "@/components/typography/text";
import { Button } from "@/components/ui/button";
import { cn } from "cn";
import { ConversationRow } from "./conversation-row";

export interface ConversationListProps {
	/** Visible conversations: the app filters tombstoned and subagent rows out before this. */
	conversations: ConversationSummary[];
	/** Tombstoned conversations, restorable. An empty list renders no group. */
	deleted: ConversationSummary[];
	activeId?: string | undefined;
	onSelect?: ((id: string) => void) | undefined;
	onRename?: ((id: string) => void) | undefined;
	onHide?: ((id: string) => void) | undefined;
	onRestore?: ((id: string) => void) | undefined;
	className?: string | undefined;
}

interface Group {
	key: string;
	label: string;
	items: ConversationSummary[];
}

function startOfDay(date: Date): Date {
	return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function daysAgo(date: Date, now: Date): number {
	return Math.round((startOfDay(now).getTime() - startOfDay(date).getTime()) / 86_400_000);
}

/** Sort key: dated rows by time, undated rows last. */
function timeOf(conversation: ConversationSummary): number {
	return conversation.updatedAt instanceof Date
		? conversation.updatedAt.getTime()
		: Number.NEGATIVE_INFINITY;
}

/**
 * Date groups for the rail, newest first. Conversations without `updatedAt` — which is all
 * of them until the gateway provides timestamps — render flat, exactly as before. Once
 * dates exist, the groups lead and undated rows fall to the tail, so a straggler never
 * displaces Today. Within each group the most recently updated comes first.
 */
export function groupConversations(
	conversations: ConversationSummary[],
	now = new Date(),
): { groups: Group[]; undated: ConversationSummary[] } {
	const sorted = [...conversations].sort((a, b) => timeOf(b) - timeOf(a));
	const dated = sorted.filter(
		(conversation): conversation is ConversationSummary & { updatedAt: Date } =>
			conversation.updatedAt instanceof Date,
	);
	const undated = sorted.filter((conversation) => !(conversation.updatedAt instanceof Date));
	if (dated.length === 0) return { groups: [], undated };

	const buckets: Record<"today" | "yesterday" | "week" | "older", ConversationSummary[]> = {
		today: [],
		yesterday: [],
		week: [],
		older: [],
	};
	for (const conversation of dated) {
		const age = daysAgo(conversation.updatedAt, now);
		if (age <= 0) buckets["today"]?.push(conversation);
		else if (age === 1) buckets["yesterday"]?.push(conversation);
		else if (age <= 7) buckets["week"]?.push(conversation);
		else buckets["older"]?.push(conversation);
	}
	const groups: Group[] = [
		{ key: "today", label: "Today", items: buckets["today"] ?? [] },
		{ key: "yesterday", label: "Yesterday", items: buckets["yesterday"] ?? [] },
		{ key: "week", label: "This week", items: buckets["week"] ?? [] },
		{ key: "older", label: "Older", items: buckets["older"] ?? [] },
	].filter((group) => group.items.length > 0);
	return { groups, undated };
}

export function ConversationList({
	conversations,
	deleted,
	activeId,
	className,
	onSelect,
	onRename,
	onHide,
	onRestore,
}: ConversationListProps) {
	const [deletedOpen, setDeletedOpen] = useState(false);
	const { groups, undated } = groupConversations(conversations);

	const row = (conversation: ConversationSummary) => (
		<ConversationRow
			key={conversation.id}
			conversation={conversation}
			active={conversation.id === activeId}
			onSelect={onSelect}
			onRename={onRename}
			onHide={onHide}
			onRestore={onRestore}
		/>
	);

	return (
		<div
			data-slot="conversation-list"
			className={cn("flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto", className)}
		>
			{conversations.length === 0 ? (
				<Text size="sm" tone="muted" className="px-2">
					No conversations yet.
				</Text>
			) : (
				<>
					{groups.map((group) => (
						<div key={group.key} className="flex flex-col gap-1">
							<Text
								size="2xs"
								weight="medium"
								tone="muted"
								className="px-2 pt-2 uppercase"
							>
								{group.label}
							</Text>
							{group.items.map(row)}
						</div>
					))}
					{/* Undated rows are a tail, never a displacement of Today. */}
					{undated.map(row)}
				</>
			)}
			{deleted.length === 0 ? null : (
				<div className="mt-1 flex flex-col gap-1">
					<Button
						type="button"
						variant="ghost"
						size="sm"
						className="justify-start text-muted-foreground"
						aria-expanded={deletedOpen}
						onClick={() => setDeletedOpen((open) => !open)}
					>
						<ChevronRight
							className={cn("transition-transform", deletedOpen && "rotate-90")}
						/>
						Deleted ({deleted.length})
					</Button>
					{deletedOpen ? (
						<div className="flex flex-col gap-1">{deleted.map(row)}</div>
					) : null}
				</div>
			)}
		</div>
	);
}
