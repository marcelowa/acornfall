import type { ReactNode } from "react";
import { ChevronRight, Maximize2, Minimize2 } from "lucide-react";
import { Button } from "@/components/ui/button";
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
	/** Open sections, owned by the app so the choice survives a reload. */
	open: string[];
	onOpenChange: (open: string[]) => void;
	/** At most one section can take the whole panel; the rest collapse to headers. */
	maximized?: string | undefined;
	onMaximizedChange: (key: string | undefined) => void;
	className?: string | undefined;
}

/**
 * The panel that answers "why did it see that". Sections are closed by default — the point
 * is to open the one that explains the surprise, not to read a wall — and one of them can
 * take the whole panel, because the answer is often a long document.
 */
export function Inspector({
	sections,
	open,
	onOpenChange,
	maximized,
	onMaximizedChange,
	className,
}: InspectorProps) {
	const toggle = (key: string): void => {
		const isOpen = open.includes(key);
		onOpenChange(isOpen ? open.filter((candidate) => candidate !== key) : [...open, key]);
	};

	return (
		<div
			data-slot="inspector"
			className={cn("flex min-h-0 flex-1 flex-col overflow-y-auto p-2", className)}
		>
			{sections.map((section) => {
				const isOpen = open.includes(section.key);
				const isMaximized = maximized === section.key;
				if (maximized !== undefined && !isMaximized) return null;
				return (
					<section
						key={section.key}
						data-section={section.key}
						className="border-b border-border last:border-b-0"
					>
						<div className="flex items-center gap-1 py-1">
							<button
								type="button"
								aria-expanded={isOpen}
								onClick={() => toggle(section.key)}
								className="flex min-w-0 flex-1 items-center gap-1.5 py-1 text-left text-sm hover:text-foreground"
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
							<Button
								type="button"
								variant="ghost"
								size="icon-xs"
								aria-label={
									isMaximized
										? "Restore the section"
										: `Maximize ${section.title}`
								}
								onClick={() => {
									if (isMaximized) {
										onMaximizedChange(undefined);
										return;
									}
									onMaximizedChange(section.key);
									if (!isOpen) onOpenChange([...open, section.key]);
								}}
							>
								{isMaximized ? <Minimize2 /> : <Maximize2 />}
							</Button>
						</div>
						{isOpen ? <div className="pb-3">{section.body}</div> : null}
					</section>
				);
			})}
		</div>
	);
}
