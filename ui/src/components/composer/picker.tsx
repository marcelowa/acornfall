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
	/** Where this value comes from: "this conversation", "workspace default", "install". */
	origin?: string | undefined;
	groups: PickerGroup[];
	onSelect: (value: string) => void;
	disabled?: boolean | undefined;
	className?: string | undefined;
}

/**
 * One picker, used for all three choices. It always says where the value came from: a
 * conversation that never chose is not the same as one that chose, and the difference is
 * exactly what someone opens this to find out.
 */
export function Picker({
	label,
	value,
	placeholder = "default",
	origin,
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
					className={cn("max-w-(--container-xs) justify-start", className)}
				>
					<span className="text-muted-foreground">{label}:</span>
					<span className="truncate">{value ?? placeholder}</span>
					{origin === undefined ? null : (
						<span className="truncate text-muted-foreground">· {origin}</span>
					)}
					<ChevronDown className="shrink-0" />
				</Button>
			</DropdownMenuTrigger>
			<DropdownMenuContent align="start" className="w-(--container-xs)">
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
							>
								<span className="truncate">{option.label}</span>
								{option.detail === undefined ? null : (
									<span className="ml-auto text-muted-foreground">
										{option.detail}
									</span>
								)}
							</DropdownMenuItem>
						))}
					</div>
				))}
				{empty ? <DropdownMenuItem disabled>Nothing to choose</DropdownMenuItem> : null}
			</DropdownMenuContent>
		</DropdownMenu>
	);
}
