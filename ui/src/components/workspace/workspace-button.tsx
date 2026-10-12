import { ChevronDown } from "lucide-react";
import { Text } from "@/components/typography/text";

/**
 * The workspace's own name is the button that opens its list. It used to be a swap icon
 * (`ChevronsUpDown`) beside the title, which said "switch" while opening a place, and the icon
 * was not a label (step 04, J10). The name is the label, the chevron only says it opens
 * something, and the whole row is the target.
 *
 * It keeps a chevron rather than an X in the same corner as the bar's toggle: the bar's button
 * is the layer's one close (step 06), so this one never says "close" — it opens.
 */
export interface WorkspaceButtonProps {
	title: string;
	expanded?: boolean | undefined;
	onClick: () => void;
}

export function WorkspaceButton({ title, expanded = false, onClick }: WorkspaceButtonProps) {
	/** The workspace's own name as the button that opens its list: 44px with a 20px chevron on a
	 * phone, the rail's own compact row from `sm` up, where nothing is tapped with a thumb. */
	return (
		<button
			type="button"
			data-slot="workspace-button"
			aria-expanded={expanded}
			onClick={onClick}
			className="flex h-11 w-full items-center gap-1.5 rounded-md px-1 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50 sm:h-8"
		>
			<Text as="span" size="sm" weight="semibold" className="min-w-0 flex-1 truncate">
				{title}
			</Text>
			<ChevronDown className="size-5 shrink-0 text-muted-foreground sm:size-4" aria-hidden />
		</button>
	);
}
