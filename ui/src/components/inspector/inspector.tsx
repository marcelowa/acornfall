import { useState, type ReactNode } from "react";
import { ChevronRight, PanelRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "cn";

export interface InspectorSection {
	key: string;
	title: string;
	/** What the section would say, in a few words, while it is closed. */
	hint?: string | undefined;
	body: ReactNode;
}

export interface InspectorProps {
	sections: InspectorSection[];
	/** Open on mount, for the catalogue: the overlay is otherwise the toggle's business. */
	defaultOpen?: boolean | undefined;
	className?: string | undefined;
}

/**
 * The panel that answers "why did it see that", as an overlay rather than a column: the
 * question is about the conversation in front of you, and it is asked rarely enough that a
 * pane which is always there costs more than it gives.
 *
 * It is not remembered. Opening it is a question you ask now; the next visit starts closed,
 * because a panel that reappears because it appeared once is a panel you have to close.
 *
 * Every section is open when the overlay opens — you asked for the details — and a section
 * can be put away while you read another.
 */
export function Inspector({ sections, defaultOpen, className }: InspectorProps) {
	const [closed, setClosed] = useState<string[]>([]);
	const initial = defaultOpen === undefined ? {} : { defaultOpen };

	const toggle = (key: string): void =>
		setClosed((current) =>
			current.includes(key)
				? current.filter((candidate) => candidate !== key)
				: [...current, key],
		);

	return (
		<Dialog {...initial}>
			<DialogTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="icon-sm"
					aria-label="Inspector"
					data-slot="inspector-toggle"
					className="fixed top-2 right-2 z-40"
				>
					<PanelRight />
				</Button>
			</DialogTrigger>
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
					{sections.map((section) => {
						const isOpen = !closed.includes(section.key);
						return (
							<section
								key={section.key}
								data-section={section.key}
								className="border-b border-border last:border-b-0"
							>
								<button
									type="button"
									aria-expanded={isOpen}
									onClick={() => toggle(section.key)}
									className="flex w-full min-w-0 items-center gap-1.5 py-2 text-left text-sm hover:text-foreground"
								>
									<ChevronRight
										className={cn(
											"size-3.5 shrink-0 transition-transform",
											isOpen && "rotate-90",
										)}
									/>
									<span className="font-medium">{section.title}</span>
									{isOpen || section.hint === undefined ? null : (
										<span className="truncate text-2xs text-muted-foreground">
											{section.hint}
										</span>
									)}
								</button>
								{isOpen ? <div className="pb-3">{section.body}</div> : null}
							</section>
						);
					})}
				</div>
			</DialogContent>
		</Dialog>
	);
}
