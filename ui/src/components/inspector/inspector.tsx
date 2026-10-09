import type { ReactNode } from "react";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "cn";
import { InspectorSections } from "./inspector-sections";

export interface InspectorSection {
	key: string;
	title: string;
	/** What the section would say, in a few words, while it is closed. */
	hint?: string | undefined;
	body: ReactNode;
}

export type InspectorProps = {
	sections: InspectorSection[];
	/** The control that asks the question. Absent in the app: the header toggle opens a
	 * controlled dialog, so there is exactly one toggle in the tree. */
	trigger?: ReactNode | undefined;
	className?: string | undefined;
} & (
	| {
			open: boolean;
			onOpenChange: (open: boolean) => void;
			defaultOpen?: never;
	  }
	| {
			open?: never;
			onOpenChange?: never;
			/** Open on mount, for the catalogue: the app always starts closed. */
			defaultOpen?: boolean;
	  }
);

/**
 * The panel that answers "why did it see that", as an overlay: the question is about the
 * conversation in front of you. Where the screen has room (2xl) the app docks the same
 * sections beside the transcript instead — see `InspectorPanel` — and this dialog stays
 * the small-screen form.
 *
 * It is not remembered. Opening it is a question you ask now; the next visit starts closed,
 * because a panel that reappears because it appeared once is a panel you have to close.
 *
 * Every section is open when the overlay opens — you asked for the details — and a section
 * can be put away while you read another.
 */
export function Inspector({
	sections,
	trigger,
	open,
	onOpenChange,
	defaultOpen,
	className,
}: InspectorProps) {
	const triggerNode =
		trigger === undefined ? null : <DialogTrigger asChild>{trigger}</DialogTrigger>;
	const content = (
		<DialogContent
			data-slot="inspector"
			className={cn(
				"inset-0 flex h-auto w-auto max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none p-0",
				"sm:inset-4 sm:max-w-none sm:rounded-lg",
				className,
			)}
		>
			<DialogHeader className="border-b border-border px-4 py-3">
				<DialogTitle>Inspector</DialogTitle>
				<DialogDescription>
					What the model saw, what the harness is doing, and where the tools run.
				</DialogDescription>
			</DialogHeader>
			<div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
				<InspectorSections sections={sections} />
			</div>
		</DialogContent>
	);
	if (open !== undefined && onOpenChange !== undefined) {
		return (
			<Dialog open={open} onOpenChange={onOpenChange}>
				{triggerNode}
				{content}
			</Dialog>
		);
	}
	return (
		<Dialog defaultOpen={defaultOpen === true}>
			{triggerNode}
			{content}
		</Dialog>
	);
}
