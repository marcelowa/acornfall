import { ChevronsUpDown } from "lucide-react";
import type { ChoicePicker } from "@/app/view-models";
import { Stack } from "@/components/layout/stack";
import { Button } from "@/components/ui/button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
	DialogTrigger,
} from "@/components/ui/dialog";
import { Text } from "@/components/typography/text";
import { Picker } from "./picker";

export interface ChoiceControlProps {
	/** What runs the conversation, in the order the summary reads: agent, model, thinking. */
	agent: ChoicePicker;
	model: ChoicePicker;
	thinking: ChoicePicker;
	/** Open on mount, for the catalogue: the dialog is otherwise the button's business. */
	defaultOpen?: boolean | undefined;
	className?: string | undefined;
}

/**
 * The three choices, as one control. They belong together — a model decides which thinking
 * levels exist, and the agent decides the model — and three buttons in a row said otherwise:
 * on a phone they wrapped, and the model's origin label alone was wider than the screen.
 *
 * The summary reads like the answer to "what will run this": `general ·
 * deepseek-v4.1-flash · max`. The layers are in the dialog, where there is room to say which
 * one a value came from and what changing it would do.
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
		<Dialog {...initial}>
			<DialogTrigger asChild>
				<Button
					type="button"
					variant="ghost"
					size="xs"
					disabled={disabled}
					data-slot="choice-control"
					aria-label="What runs this conversation"
					className={className}
				>
					{choices.map((choice, index) => (
						<span key={choice.key} className="flex min-w-0 items-baseline gap-1">
							{index > 0 ? (
								<span aria-hidden className="text-muted-foreground">
									·
								</span>
							) : null}
							<span
								className={
									choice.key === "model"
										? "min-w-0 truncate font-medium"
										: "shrink-0"
								}
							>
								{choice.picker.value === "" ? "not set" : choice.picker.value}
							</span>
						</span>
					))}
					<ChevronsUpDown className="shrink-0" />
				</Button>
			</DialogTrigger>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>What runs this conversation</DialogTitle>
					<DialogDescription>
						A conversation pins what it started with. Changing a default shapes the ones
						that come after it.
					</DialogDescription>
				</DialogHeader>
				<Stack gap="md">
					{choices.map((choice) => (
						<Stack key={choice.key} gap="2xs">
							<Text size="2xs" tone="muted">
								{choice.label}
							</Text>
							<Picker
								label={choice.label}
								value={choice.picker.value}
								placeholder="not set"
								origin={choice.picker.origin}
								note={choice.picker.note}
								groups={choice.picker.groups}
								onSelect={choice.picker.onSelect}
								disabled={choice.picker.disabled}
								className="w-full"
							/>
						</Stack>
					))}
				</Stack>
			</DialogContent>
		</Dialog>
	);
}
