import type { ConversationSummary } from "@/app/view-models";
import { Text } from "@/components/typography/text";
import { cn } from "@/lib/utils";
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
	title?: string | undefined;
	className?: string | undefined;
}

export function ConversationList({
	conversations,
	deleted,
	activeId,
	title = "Conversations",
	className,
	onSelect,
	onRename,
	onHide,
	onRestore,
}: ConversationListProps) {
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
		<div className={cn("flex flex-col gap-1", className)}>
			<Text as="h2" size="sm" weight="semibold" className="px-2 pb-1">
				{title}
			</Text>
			{conversations.length === 0 ? (
				<Text size="sm" tone="muted" className="px-2">
					No conversations yet.
				</Text>
			) : (
				conversations.map(row)
			)}
			{deleted.length === 0 ? null : (
				<details className="mt-1">
					<summary className="cursor-pointer rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-accent/50">
						Deleted ({deleted.length})
					</summary>
					<div className="mt-1 flex flex-col gap-1">{deleted.map(row)}</div>
				</details>
			)}
		</div>
	);
}
