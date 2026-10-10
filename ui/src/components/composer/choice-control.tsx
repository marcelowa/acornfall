import { Check, ChevronsUpDown } from "lucide-react";
import type { ChoicePicker } from "@/app/view-models";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "cn";

export interface ChoiceControlProps {
	/** What runs the conversation, in the order the summary reads: agent, model, thinking. */
	agent: ChoicePicker;
	model: ChoicePicker;
	thinking: ChoicePicker;
	/** Open on mount, for the catalogue: the menu is otherwise the button's business. */
	defaultOpen?: boolean | undefined;
	className?: string | undefined;
}

/**
 * The three choices, as one control. They belong together — a model decides which thinking
 * levels exist, and the agent decides the model — and three buttons in a row said otherwise:
 * on a phone they wrapped, and three triggers took three times the room.
 *
 * The summary reads like the answer to "what will run this": `general ·
 * deepseek-v4.1-flash · max`, and the menu above it is the three pickers and nothing else —
 * no title, no explanation, and no label repeated above the label each section already has.
 * A tap outside closes it, and picking keeps it open so all three can change in one go.
 */
export function ChoiceControl({
	agent,
	model,
	thinking,
	defaultOpen,
	className,
}: ChoiceControlProps) {
	const choices = [
		{ key: "agent", label: "Agent", picker: agent },
		{ key: "model", label: "Model", picker: model },
		{ key: "thinking", label: "Thinking", picker: thinking },
	] as const;
	const disabled = choices.every((choice) => choice.picker.disabled === true);
	// Radix wants a defined value when it is given one; absent is the button's business.
	const initial = defaultOpen === undefined ? {} : { defaultOpen };

	return (
		<Popover {...initial}>
			<PopoverTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="xs"
					disabled={disabled}
					data-slot="choice-control"
					aria-label="What runs this conversation"
					className={cn("w-full sm:w-auto", className)}
				>
					{choices.map((choice, index) => (
						<span key={choice.key} className="flex min-w-0 items-baseline gap-1">
							{index > 0 ? (
								<span aria-hidden className="text-muted-foreground">
									·
								</span>
							) : null}
							<span
								className={cn(
									choice.key === "model"
										? "min-w-0 truncate font-medium"
										: "shrink-0",
									choice.picker.invalid === true && "text-destructive",
								)}
							>
								{choice.picker.value === "" ? "not set" : choice.picker.value}
							</span>
						</span>
					))}
					{choices.map((choice) =>
						choice.picker.note === undefined ? null : (
							<span
								key={`${choice.key}-note`}
								className={cn(
									"shrink-0",
									choice.picker.invalid === true
										? "text-destructive"
										: "text-muted-foreground",
								)}
							>
								· {choice.picker.note}
							</span>
						),
					)}
					<ChevronsUpDown className="shrink-0" />
				</Button>
			</PopoverTrigger>
			<PopoverContent
				side="top"
				align="start"
				sideOffset={8}
				className="max-h-80 w-[min(20rem,calc(100vw-2rem))] overflow-y-auto p-1"
			>
				{choices.map((choice, choiceIndex) => {
					const empty = choice.picker.groups.every((group) => group.options.length === 0);
					return (
						<div key={choice.key}>
							{choiceIndex > 0 ? (
								<div aria-hidden className="-mx-1 my-1 h-px bg-border" />
							) : null}
							<div className="flex items-baseline gap-2 px-2 py-1.5">
								<span className="text-sm font-medium">{choice.label}</span>
								{choice.picker.note === undefined ? null : (
									<span
										className={cn(
											"truncate text-xs",
											choice.picker.invalid === true
												? "text-destructive"
												: "text-muted-foreground",
										)}
									>
										{choice.picker.note}
									</span>
								)}
							</div>
							{choice.picker.groups.map((group, groupIndex) => (
								<div key={group.label ?? String(groupIndex)}>
									{group.label === undefined ? null : (
										<div className="px-2 py-1 text-xs font-medium text-muted-foreground">
											{group.label}
										</div>
									)}
									{group.options.map((option) => {
										const selected = option.value === choice.picker.value;
										return (
											<button
												key={option.value}
												type="button"
												role="menuitemradio"
												aria-checked={selected}
												disabled={choice.picker.disabled}
												onClick={() => choice.picker.onSelect(option.value)}
												className="flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-hidden select-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground disabled:pointer-events-none disabled:opacity-50"
											>
												<Check
													className={cn(
														"mt-0.5 size-4 shrink-0",
														selected ? "opacity-100" : "opacity-0",
													)}
												/>
												<span className="flex min-w-0 flex-col gap-0.5">
													<span className="flex items-baseline gap-2">
														<span className="truncate font-medium">
															{option.label}
														</span>
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
											</button>
										);
									})}
								</div>
							))}
							{empty ? (
								<div className="px-2 py-1.5 text-sm text-muted-foreground">
									Nothing to choose
								</div>
							) : null}
						</div>
					);
				})}
			</PopoverContent>
		</Popover>
	);
}
