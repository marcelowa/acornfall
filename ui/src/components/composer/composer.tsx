import { useEffect, useRef, type KeyboardEvent, type ReactNode } from "react";
import { ArrowUp } from "lucide-react";
import { Measure } from "@/components/layout/measure";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "cn";
import { stepSlashIndex } from "./slash-menu";

/** True on touch devices: Enter must not send there. */
function isCoarsePointer(): boolean {
	try {
		return window.matchMedia("(pointer: coarse)").matches;
	} catch {
		return false;
	}
}

export interface ComposerProps {
	value: string;
	onChange: (value: string) => void;
	onSend: () => void;
	onAbort: () => void;
	/** A run is underway: the send button says how the message will land, and Stop appears. */
	running: boolean;
	/** The worker can take a steering input mid-turn; without it Queue is the only landing. */
	steerable: boolean;
	/** Send the draft into the running turn. */
	onSteer: () => void;
	/** Send the draft behind the running turn. */
	onQueue: () => void;
	/** An abort is in flight: Stop stays a button and goes quiet until it lands. */
	aborting?: boolean | undefined;
	disabled?: boolean | undefined;
	placeholder?: string | undefined;
	/** The pickers row: model, thinking, agent. */
	controls?: ReactNode | undefined;
	/** Above the card: the slash-command menu, when one is open. */
	above?: ReactNode | undefined;
	/**
	 * The conversation in view: arriving somewhere new moves the caret home to the composer.
	 * Never on a coarse pointer — focusing the field would pop the keyboard uninvited.
	 */
	focusConversation?: string | undefined;
	/** Slash keyboard navigation: how many rows are open and which is highlighted. */
	slashCount?: number | undefined;
	slashIndex?: number | undefined;
	onSlashIndexChange?: ((index: number) => void) | undefined;
	onSlashPick?: ((index: number) => void) | undefined;
	onSlashDismiss?: (() => void) | undefined;
	className?: string | undefined;
}

/**
 * The composer: one card holding the draft and everything it can do. It owns the keyboard
 * contract — Enter sends on a fine pointer, Shift+Enter is always a newline, and on a
 * coarse pointer Enter is always a newline too, so a phone never sends by accident.
 * While the slash menu is open the arrows move its highlight, Enter picks it, and Escape
 * dismisses it. What the message means is the server's business.
 */
export function Composer({
	value,
	onChange,
	onSend,
	onAbort,
	running,
	steerable,
	onSteer,
	onQueue,
	aborting = false,
	disabled = false,
	placeholder = "Send a message",
	controls,
	above,
	focusConversation,
	slashCount = 0,
	slashIndex = 0,
	onSlashIndexChange,
	onSlashPick,
	onSlashDismiss,
	className,
}: ComposerProps) {
	const canSend = !disabled && value.trim() !== "";
	const slashOpen = slashCount > 0;
	const field = useRef<HTMLTextAreaElement>(null);
	useEffect(() => {
		if (focusConversation === undefined) return;
		if (isCoarsePointer()) return;
		field.current?.focus({ preventScroll: true });
	}, [focusConversation]);

	const submit = (): void => {
		if (!canSend) return;
		onSend();
	};

	const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
		// Enter sends on a fine pointer only: Shift+Enter is always a newline, and on a
		// coarse pointer Enter is a newline too. The one exception is the slash menu,
		// where Enter completes the highlighted command instead of sending anything.
		if (event.key === "Enter" && !event.shiftKey && slashOpen) {
			event.preventDefault();
			onSlashPick?.(slashIndex);
			return;
		}
		if (event.key === "Enter" && !event.shiftKey && !slashOpen && !isCoarsePointer()) {
			event.preventDefault();
			submit();
			return;
		}
		if (!slashOpen) return;
		if (event.key === "ArrowDown") {
			event.preventDefault();
			onSlashIndexChange?.(stepSlashIndex(slashIndex, 1, slashCount));
		} else if (event.key === "ArrowUp") {
			event.preventDefault();
			onSlashIndexChange?.(stepSlashIndex(slashIndex, -1, slashCount));
		} else if (event.key === "Escape") {
			event.preventDefault();
			onSlashDismiss?.();
		}
	};

	return (
		<div data-slot="composer" className={cn("w-full border-t border-border", className)}>
			<Measure size="wide" padding="md">
				{above}
				<div className="rounded-xl border border-border bg-card shadow-sm transition-[border-color] focus-within:border-ring">
					<Textarea
						ref={field}
						value={value}
						onChange={(event) => onChange(event.target.value)}
						onKeyDown={onKeyDown}
						disabled={disabled}
						placeholder={placeholder}
						aria-label="Message"
						role="combobox"
						aria-expanded={slashOpen}
						aria-controls="slash-menu-listbox"
						aria-autocomplete="list"
						aria-activedescendant={slashOpen ? `slash-option-${slashIndex}` : undefined}
						className="max-h-(--composer-max-height) rounded-t-xl border-0 bg-transparent shadow-none focus-visible:border-transparent focus-visible:ring-0 md:text-base dark:bg-transparent"
					/>
					<div className="flex flex-col gap-2 px-2 pb-2 sm:flex-row sm:items-end">
						<div className="order-2 flex min-w-0 flex-1 flex-wrap items-center gap-1 sm:order-1">
							{controls}
						</div>
						<div className="order-1 flex shrink-0 items-center gap-1 self-end sm:order-2 sm:self-auto">
							{running ? (
								<>
									<Button
										type="button"
										variant="outline"
										size="sm"
										onClick={onAbort}
										disabled={aborting}
									>
										Stop
									</Button>
									{steerable ? (
										<Button
											type="button"
											size="sm"
											onClick={onSteer}
											disabled={!canSend}
										>
											Steer
										</Button>
									) : null}
									<Button
										type="button"
										variant="secondary"
										size="sm"
										onClick={onQueue}
										disabled={!canSend}
									>
										Queue
									</Button>
								</>
							) : (
								<Button
									type="button"
									size="icon"
									className="rounded-full"
									aria-label="Send"
									onClick={submit}
									disabled={!canSend}
								>
									<ArrowUp />
								</Button>
							)}
						</div>
					</div>
				</div>
			</Measure>
		</div>
	);
}
