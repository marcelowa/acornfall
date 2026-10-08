import { Text } from "@/components/typography/text";
import { cn } from "cn";
import type { InspectorSection } from "./inspector";
import { InspectorSections } from "./inspector-sections";

export interface InspectorPanelProps {
	sections: InspectorSection[];
	className?: string | undefined;
}

/**
 * The inspector as a docked column: the same sections as the dialog, beside the transcript
 * instead of over it. The app shows it where the screen has room (2xl) while it is asked
 * for; below that the dialog is the form.
 */
export function InspectorPanel({ sections, className }: InspectorPanelProps) {
	return (
		<div
			data-slot="inspector-panel"
			className={cn(
				"flex min-h-0 min-w-0 flex-1 flex-col border-l border-border bg-card",
				className,
			)}
		>
			<div className="shrink-0 border-b border-border px-4 py-3">
				<Text as="h2" size="sm" weight="semibold">
					Inspector
				</Text>
				<Text size="xs" tone="muted">
					What the model saw, what the harness is doing, and where the tools run.
				</Text>
			</div>
			<div className="min-h-0 flex-1 overflow-y-auto px-4 py-2">
				<InspectorSections sections={sections} />
			</div>
		</div>
	);
}
