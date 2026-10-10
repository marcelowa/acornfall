import { useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { PickerGroup } from "@/app/view-models";
import { Button } from "@/components/ui/button";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { cn } from "cn";

export interface PickerProps {
	/** What is being chosen: "Model", "Thinking", "Agent". */
	label: string;
	value?: string | undefined;
	placeholder?: string | undefined;
	/** Something the value cannot say by itself: a level that was asked for and not offered. */
	note?: string | undefined;
	/** The value cannot run here any more, so it is shown as a problem rather than a choice. */
	invalid?: boolean | undefined;
	groups: PickerGroup[];
	onSelect: (value: string) => void;
	disabled?: boolean | undefined;
	/** Open on mount, for the catalogue: the menu is otherwise the button's business. */
	defaultOpen?: boolean | undefined;
	className?: string | undefined;
}

/** Options on screen before narrowing: the same eight the slash menu shows. */
export const PICKER_FILTER_AFTER = 8;

/**
 * Substring narrowing across groups, the way the slash menu and the scripted provider
 * match: the label and the value both count, so `opus` finds `Opus 5` either way it is
 * written. An empty query is the whole list.
 */
export function filterPickerGroups(groups: PickerGroup[], query: string): PickerGroup[] {
	const needle = query.trim().toLowerCase();
	if (needle === "") return groups;
	return groups
		.map((group) => ({
			...group,
			options: group.options.filter((option) =>
				`${option.label} ${option.value}`.toLowerCase().includes(needle),
			),
		}))
		.filter((group) => group.options.length > 0);
}

/**
 * One picker, used for all three choices. The label, the value, and the menu — nothing else:
 * the layers are the settings screen's tabs, and a value that is inherited is shown as the
 * value it is.
 *
 * Past eight options the menu grows a filter: a dozen models are found by typing, not by
 * scrolling. The menu owns Escape and Tab; every other keystroke is the query's, so the
 * caret stays where the typing is.
 *
 * An invalid value is shown in the destructive tone with its note, because a pin that cannot
 * run is not a choice to read past.
 */
export function Picker({
	label,
	value,
	placeholder = "not set",
	note,
	invalid = false,
	groups,
	onSelect,
	disabled = false,
	defaultOpen = false,
	className,
}: PickerProps) {
	const [open, setOpen] = useState(defaultOpen);
	const [query, setQuery] = useState("");
	const filter = useRef<HTMLInputElement>(null);
	const total = groups.reduce((count, group) => count + group.options.length, 0);
	const narrowable = total > PICKER_FILTER_AFTER;
	const shown = filterPickerGroups(groups, query);
	const matched = shown.reduce((count, group) => count + group.options.length, 0);

	return (
		<DropdownMenu
			open={open}
			onOpenChange={(next) => {
				setOpen(next);
				if (!next) {
					setQuery("");
				} else if (narrowable) {
					// Radix takes focus into the list on open; the filter is the typing
					// surface, so it claims focus on the frame after.
					requestAnimationFrame(() => filter.current?.focus());
				}
			}}
		>
			<DropdownMenuTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="xs"
					disabled={disabled}
					aria-label={label}
					className={cn("min-w-0 max-w-full justify-start", className)}
					title={value === undefined || value === "" ? undefined : value}
				>
					<span className="text-muted-foreground">{label}:</span>
					<span className={cn("truncate", invalid && "text-destructive")}>
						{value === undefined || value === "" ? placeholder : value}
					</span>
					{note === undefined ? null : (
						<span
							className={cn(
								"truncate",
								invalid ? "text-destructive" : "text-muted-foreground",
							)}
						>
							· {note}
						</span>
					)}
					<ChevronDown className="shrink-0" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent side="top" align="start" className="w-(--container-sm)">
				{narrowable ? (
					<div className="p-1">
						<Input
							ref={filter}
							inputSize="sm"
							value={query}
							onChange={(event) => setQuery(event.target.value)}
							placeholder={`Filter ${label.toLowerCase()}…`}
							aria-label={`Filter ${label} options`}
							onKeyDown={(event) => {
								if (event.key !== "Escape" && event.key !== "Tab") {
									event.stopPropagation();
								}
							}}
						/>
					</div>
				) : null}
				{shown.map((group, index) => (
					<div key={group.label ?? String(index)}>
						{index > 0 ? <DropdownMenuSeparator /> : null}
						{group.label === undefined ? null : (
							<DropdownMenuLabel>{group.label}</DropdownMenuLabel>
						)}
						{group.options.map((option) => (
							<DropdownMenuItem
								key={option.value}
								onSelect={() => onSelect(option.value)}
								className="items-start"
							>
								<span className="flex min-w-0 flex-col gap-0.5">
									<span className="flex items-baseline gap-2">
										<span className="truncate font-medium">{option.label}</span>
										{option.detail === undefined ? null : (
											<span className="shrink-0 font-mono text-2xs text-muted-foreground">
												{option.detail}
											</span>
										)}
									</span>
									{option.description === undefined ? null : (
										<span className="whitespace-normal text-2xs text-muted-foreground">
											{option.description}
										</span>
									)}
								</span>
							</DropdownMenuItem>
						))}
					</div>
				))}
				{total === 0 ? (
					<DropdownMenuItem disabled>Nothing to choose</DropdownMenuItem>
				) : matched === 0 ? (
					<DropdownMenuItem disabled>No matches — keep typing to narrow</DropdownMenuItem>
				) : null}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
