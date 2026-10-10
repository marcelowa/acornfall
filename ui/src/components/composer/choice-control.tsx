import { ChevronsUpDown } from "lucide-react";
import type { ChoicePicker } from "@/app/view-models";
import { Stack } from "@/components/layout/stack";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "cn";
import { Picker } from "./picker";

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
 * deepseek-v4.1-flash · max`, and the square above it is the three pickers and nothing
 * else — no title, no explanation, and no label repeated above the label the picker
 * already has. One long menu did not scale: a dozen models buried thinking below the
 * fold, so each dimension narrows on its own, and a long one grows a filter. A tap
 * outside closes the square, and picking keeps it open so all three can change in one go.
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
			<PopoverContent side="top" align="start" sideOffset={8}>
				<Stack gap="sm">
					{choices.map((choice) => (
						<Picker
							key={choice.key}
							label={choice.label}
							value={choice.picker.value}
							placeholder="not set"
							note={choice.picker.note}
							invalid={choice.picker.invalid}
							groups={choice.picker.groups}
							onSelect={choice.picker.onSelect}
							disabled={choice.picker.disabled}
							className="w-full"
						/>
					))}
				</Stack>
			</PopoverContent>
		</Popover>
	);
}
