import type { SlashCommand } from "@/app/view-models";
import { cn } from "cn";

export interface SlashMenuProps {
	commands: SlashCommand[];
	/** The chosen command's invocation, `/name `, ready to replace the draft's first word. */
	onSelect: (invocation: string) => void;
	className?: string | undefined;
}

/**
 * The commands the server would expand, offered while someone types one. The expansion itself
 * happens server-side — this is only the list, so what is sent is what the worker parses.
 */
export function SlashMenu({ commands, onSelect, className }: SlashMenuProps) {
	if (commands.length === 0) return null;

	return (
		<div
			data-slot="slash-menu"
			className={cn(
				"mb-2 overflow-hidden rounded-md border border-border bg-popover shadow-md",
				className,
			)}
		>
			{commands.map((command) => (
				<button
					key={command.name}
					type="button"
					// Keep the caret in the textarea: the menu is a detour, not a destination.
					onMouseDown={(event) => event.preventDefault()}
					onClick={() => onSelect(`/${command.name} `)}
					className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
				>
					<span className="font-mono">/{command.name}</span>
					{command.argumentHint === undefined ? null : (
						<span className="font-mono text-2xs text-muted-foreground">
							{command.argumentHint}
						</span>
					)}
					{command.description === undefined ? null : (
						<span className="ml-auto truncate text-2xs text-muted-foreground">
							{command.description}
						</span>
					)}
				</button>
			))}
		</div>
	);
}
