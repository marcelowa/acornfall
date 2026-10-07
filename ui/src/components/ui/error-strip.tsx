import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "cn";

export interface ErrorStripProps {
	/** The server's own words: a refusal is an answer, and paraphrasing it loses the answer. */
	message: string;
	onDismiss: () => void;
	className?: string | undefined;
}

/**
 * The last refused action. It stays until it is dismissed — a failure worth telling someone
 * about is worth leaving where they will read it — and the next successful action clears it.
 * Where it sits is the shell's business, so it carries no margin of its own.
 */
export function ErrorStrip({ message, onDismiss, className }: ErrorStripProps) {
	return (
		<div
			data-slot="error-strip"
			role="alert"
			className={cn(
				"flex items-start gap-2 rounded-md border border-destructive/40 bg-destructive-subtle px-3 py-2",
				className,
			)}
		>
			<span className="min-w-0 flex-1 text-sm break-words whitespace-pre-wrap text-destructive-subtle-foreground">
				{message}
			</span>
			<Button
				type="button"
				variant="ghost"
				size="icon-xs"
				aria-label="Dismiss the error"
				onClick={onDismiss}
			>
				<X />
			</Button>
		</div>
	);
}
