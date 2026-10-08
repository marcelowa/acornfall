import { useState } from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "cn";
import type { InspectorSection } from "./inspector";

export interface InspectorSectionsProps {
	sections: InspectorSection[];
	className?: string | undefined;
}

/**
 * The accordion itself: every section open, any section put away while another is read.
 * Shared by the dialog and the docked panel, so the two forms can never disagree about
 * what "the details" contain.
 */
export function InspectorSections({ sections, className }: InspectorSectionsProps) {
	const [closed, setClosed] = useState<string[]>([]);

	const toggle = (key: string): void =>
		setClosed((current) =>
			current.includes(key)
				? current.filter((candidate) => candidate !== key)
				: [...current, key],
		);

	return (
		<div className={className}>
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
							className="flex w-full min-w-0 items-center gap-1.5 rounded-md py-2 text-left text-sm outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/50"
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
	);
}
