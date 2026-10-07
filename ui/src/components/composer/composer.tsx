import type { ReactNode } from "react";
import { Stack } from "@/components/layout/stack";
import { Measure } from "@/components/layout/measure";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import type { BusyAction } from "@/app/view-models";
import { cn } from "cn";

export interface ComposerProps {
	value: string;
	onChange: (value: string) => void;
	onSend: () => void;
	onAbort: () => void;
	/** A run is underway: the send button says how the message will land, and Stop appears. */
	running: boolean;
	/** The worker can take a steering input mid-turn; without it there is no choice to offer. */
	steerable: boolean;
	busyAction: BusyAction;
	onBusyActionChange: (action: BusyAction) => void;
	disabled?: boolean | undefined;
	placeholder?: string | undefined;
	/** The pickers row: model, thinking, agent. */
	controls?: ReactNode | undefined;
	/** Above the textarea: the slash-command menu, when one is open. */
	above?: ReactNode | undefined;
	className?: string | undefined;
}

/**
 * The composer. It owns the keyboard contract — Enter sends, Shift+Enter is a newline — and
 * the shape of a turn while one is running: stop, or send and say whether that steers the
 * live turn or queues behind it. What the message means is the server's business.
 */
export function Composer({
	value,
	onChange,
	onSend,
	onAbort,
	running,
	steerable,
	busyAction,
	onBusyActionChange,
	disabled = false,
	placeholder = "Send a message",
	controls,
	above,
	className,
}: ComposerProps) {
	const canSend = !disabled && value.trim() !== "";

	const submit = (): void => {
		if (!canSend) return;
		onSend();
	};

	return (
		<div data-slot="composer" className={cn("w-full border-t border-border", className)}>
			<Measure size="wide" padding="md">
				{above}
				<Stack gap="sm">
					<Textarea
						value={value}
						onChange={(event) => onChange(event.target.value)}
						onKeyDown={(event) => {
							if (event.key === "Enter" && !event.shiftKey) {
								event.preventDefault();
								if (!running) submit();
							}
						}}
						disabled={disabled}
						placeholder={placeholder}
						className="max-h-(--composer-max-height)"
					/>
					<Stack direction="horizontal" gap="sm" align="center" justify="between">
						<Stack direction="horizontal" gap="xs" align="center" className="min-w-0">
							{controls}
						</Stack>
						{running ? (
							<Stack direction="horizontal" gap="sm" align="center">
								{steerable ? (
									<ToggleGroup
										type="single"
										value={busyAction}
										onValueChange={(next) => {
											if (next === "steer" || next === "followUp")
												onBusyActionChange(next);
										}}
										variant="outline"
										size="sm"
										spacing={0}
									>
										<ToggleGroupItem value="steer">Steer</ToggleGroupItem>
										<ToggleGroupItem value="followUp">Queue</ToggleGroupItem>
									</ToggleGroup>
								) : null}
								<Button variant="outline" size="sm" onClick={onAbort}>
									Stop
								</Button>
								<Button size="sm" onClick={submit} disabled={!canSend}>
									{busyAction === "steer" ? "Steer" : "Queue"}
								</Button>
							</Stack>
						) : (
							<Button size="sm" onClick={submit} disabled={!canSend}>
								Send
							</Button>
						)}
					</Stack>
				</Stack>
			</Measure>
		</div>
	);
}
