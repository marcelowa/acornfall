import type { NoticeEntry } from "@/app/view-models";
import { Text } from "@/components/typography/text";
import { formatAt } from "./pane-footer";

export interface NoticeLineProps {
	entry: NoticeEntry;
}

/** Compaction and reset are lines of their own, not messages: they happened to the context. */
export function NoticeLine({ entry }: NoticeLineProps) {
	return (
		<div data-slot="notice" className="text-center">
			<Text as="span" size="sm" tone="muted">
				{entry.text}
				{entry.at === undefined ? "" : ` · ${formatAt(entry.at)}`}
			</Text>
		</div>
	);
}
