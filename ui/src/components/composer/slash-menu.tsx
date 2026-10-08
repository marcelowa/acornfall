import type { SlashCommand } from "@/app/view-models";
import { Text } from "@/components/typography/text";
import { cn } from "cn";

/** Rows on screen at once; the rest narrow as someone keeps typing. */
export const SLASH_MAX_ROWS = 8;

export interface SlashMenuProps {
	commands: SlashCommand[];
	/** The chosen command's invocation, `/name `, ready to replace the draft's first word. */
	onSelect: (invocation: string) => void;
	/** The keyboard-highlighted row; hover syncs it. */
	highlighted?: number | undefined;
	onHighlight?: ((index: number) => void) | undefined;
	className?: string | undefined;
}

/** One step of arrow-key navigation, wrapping around the list. */
export function stepSlashIndex(current: number, delta: 1 | -1, count: number): number {
	if (count <= 0) return 0;
	return (current + delta + count) % count;
}

/**
 * The commands the server would expand, offered while someone types one. The expansion itself
 * happens server-side — this is only the list, so what is sent is what the worker parses.
 *
 * Arrow keys move the highlight, Enter picks it, Escape dismisses the menu for the word
 * being typed; the wiring lives in the composer, which owns the textarea.
 */
export function SlashMenu({
	commands,
	onSelect,
	highlighted = 0,
	onHighlight,
	className,
}: SlashMenuProps) {
	if (commands.length === 0) return null;
	const rows = commands.slice(0, SLASH_MAX_ROWS);
	const overflow = commands.length - rows.length;

	return (
		<div
			data-slot="slash-menu"
			role="listbox"
			id="slash-menu-listbox"
			aria-label="Slash commands"
			className={cn(
				"mb-2 overflow-hidden rounded-md border border-border bg-popover shadow-md",
				className,
			)}
		>
			{rows.map((command, index) => (
				<button
					key={command.name}
					type="button"
					role="option"
					id={`slash-option-${index}`}
					aria-selected={index === highlighted}
					// Keep the caret in the textarea: the menu is a detour, not a destination.
					onMouseDown={(event) => event.preventDefault()}
					onClick={() => onSelect(`/${command.name} `)}
					onMouseEnter={() => onHighlight?.(index)}
					data-active={index === highlighted}
					className="flex w-full items-baseline gap-2 px-3 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground data-[active=true]:bg-accent data-[active=true]:text-accent-foreground"
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
			{overflow > 0 ? (
				<div className="border-t border-border px-3 py-1">
					<Text as="span" size="2xs" tone="muted">
						+{overflow} more — keep typing to narrow
					</Text>
				</div>
			) : null}
		</div>
	);
}
