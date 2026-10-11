import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Text } from "@/components/typography/text";
import type { CompactPreview } from "@/app/client";

export interface CompactDialogProps {
	open: boolean;
	/** The scope the worker counted; absent while it loads. */
	preview?: CompactPreview | undefined;
	/** The last reply's context line, when one is known. */
	contextText?: string | undefined;
	onKeep: () => void;
	onCancel: () => void;
}

/**
 * Before a manual compaction: what it folds and what it keeps. The note itself
 * cannot be shown — it does not exist until the run writes it — so the dialog
 * states the scope instead: turns, entries, and the newest part staying whole.
 */
export function CompactDialog({
	open,
	preview,
	contextText,
	onKeep,
	onCancel,
}: CompactDialogProps) {
	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) onCancel();
			}}
		>
			<DialogContent className="sm:max-w-sm">
				<DialogHeader>
					<DialogTitle>Compact this talk?</DialogTitle>
					<DialogDescription>
						The old turns fold into one note. The full log stays on disk.
					</DialogDescription>
				</DialogHeader>
				{preview === undefined ? (
					<Text size="sm" tone="muted">
						Counting turns…
					</Text>
				) : (
					<Text as="div" size="sm">
						{preview.turns} {preview.turns === 1 ? "turn" : "turns"} · {preview.entries}{" "}
						{preview.entries === 1 ? "entry" : "entries"}
						{contextText === undefined ? "" : ` · ${contextText}`}
						<br />
						<Text as="span" size="sm" tone="muted">
							The newest part stays whole. The note lands in the transcript.
						</Text>
					</Text>
				)}
				<DialogFooter>
					<Button variant="ghost" onClick={onCancel}>
						Cancel
					</Button>
					<Button disabled={preview === undefined} onClick={onKeep}>
						Compact
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
