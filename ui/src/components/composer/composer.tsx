import type { ReactNode } from "react";
import { Measure } from "@/components/layout/measure";
import { Stack } from "@/components/layout/stack";
import { Button } from "@/components/ui/button";
import { ErrorStrip } from "@/components/ui/error-strip";
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
	/** The last refused action, shown above the textarea until dismissed. */
	error?: string | undefined;
	onDismissError?: (() => void) | undefined;
	className?: string | undefined;
}

/**
 * The composer. It owns the keyboard contract — Enter sends, Shift+Enter is a newline — and
 * the shape of a turn while one is running: stop, or send and say whether that steers the
 * live turn or queues behind it. What the message means is the server's business.
 *
 * The controls and the actions wrap instead of sharing one line: a phone gets them on their
 * own rows, rather than a row that runs off the screen.
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
	error,
	onDismissError,
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
				{error === undefined || onDismissError === undefined ? null : (
					<ErrorStrip message={error} onDismiss={onDismissError} />
				)}
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
					{/* One line on a wide screen, two rows on a phone: the controls get the width they
					 * need instead of sharing it with four action buttons and truncating to a letter. */}
					<div className="flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
						<div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
							{controls}
						</div>
						<div className="flex shrink-0 items-center justify-end gap-2">
							{running ? (
								<>
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
											<ToggleGroupItem value="followUp">
												Queue
											</ToggleGroupItem>
										</ToggleGroup>
									) : null}
									<Button variant="outline" size="sm" onClick={onAbort}>
										Stop
									</Button>
									<Button size="sm" onClick={submit} disabled={!canSend}>
										{busyAction === "steer" ? "Steer" : "Queue"}
									</Button>
								</>
							) : (
								<Button size="sm" onClick={submit} disabled={!canSend}>
									Send
								</Button>
							)}
						</div>
					</div>
				</Stack>
			</Measure>
		</div>
	);
}
