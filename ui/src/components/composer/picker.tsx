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
	className?: string | undefined;
}

/**
 * One picker, used for all three choices. The label, the value, and the menu — nothing else:
 * the layers are the settings screen's tabs, and a value that is inherited is shown as the
 * value it is.
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
	className,
}: PickerProps) {
	const empty = groups.every((group) => group.options.length === 0);

	return (
		<DropdownMenu>
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
			<DropdownMenuContent align="start" className="w-(--container-sm)">
				{groups.map((group, index) => (
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
				{empty ? <DropdownMenuItem disabled>Nothing to choose</DropdownMenuItem> : null}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
