import { useEffect, useRef, type ChangeEvent, type KeyboardEvent, type ReactNode } from "react";
import { ArrowUp, Paperclip, X } from "lucide-react";
import { Measure } from "@/components/layout/measure";
import { Text } from "@/components/typography/text";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatFileSize } from "@/lib/attachments";
import { formatContext } from "@/lib/format";
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

/** A file picked for the draft: staging, staged, or refused with its reason. */
export interface ComposerAttachment {
	key: string;
	name: string;
	size: number;
	status: "uploading" | "ready" | "failed";
	error?: string | undefined;
}

export interface ComposerProps {
	value: string;
	onChange: (value: string) => void;
	onSend: () => void;
	/** Files riding the draft, staged under the workspace's hidden folder. */
	attachments?: ComposerAttachment[] | undefined;
	/** Stage picked files; refusals arrive as failed chips. */
	onAttachFiles?: ((files: File[]) => void) | undefined;
	/** Drop a chip; an upload landing later finds nothing to update. */
	onRemoveAttachment?: ((key: string) => void) | undefined;
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
	/**
	 * A new conversation the person asked for: the caret moves home even on a coarse
	 * pointer, where an arrival alone must not pop the keyboard.
	 */
	focusToken?: number | undefined;
	/** The last reply's input tokens, from the provider — absent until one lands. */
	contextUsed?: number | undefined;
	/** The running model's window, when the providers name it. */
	contextWindow?: number | undefined;
	/** Start a manual compaction. Shown once the context is mostly full. */
	onCompact?: (() => void) | undefined;
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
	attachments = [],
	onAttachFiles,
	onRemoveAttachment,
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
	focusToken,
	contextUsed,
	contextWindow,
	onCompact,
	slashCount = 0,
	slashIndex = 0,
	onSlashIndexChange,
	onSlashPick,
	onSlashDismiss,
	className,
}: ComposerProps) {
	const readyCount = attachments.filter((entry) => entry.status === "ready").length;
	const uploadingCount = attachments.filter((entry) => entry.status === "uploading").length;
	// Files may ride alone, but never half-staged: the send waits for uploads.
	const canSend = !disabled && (value.trim() !== "" || readyCount > 0) && uploadingCount === 0;
	const slashOpen = slashCount > 0;
	const field = useRef<HTMLTextAreaElement>(null);
	const fileInput = useRef<HTMLInputElement>(null);
	const pickFiles = (event: ChangeEvent<HTMLInputElement>): void => {
		const files = Array.from(event.target.files ?? []);
		event.target.value = "";
		if (files.length > 0) onAttachFiles?.(files);
	};
	useEffect(() => {
		if (focusConversation === undefined) return;
		if (isCoarsePointer()) return;
		field.current?.focus({ preventScroll: true });
	}, [focusConversation]);
	useEffect(() => {
		if (focusToken === undefined || focusToken === 0) return;
		field.current?.focus({ preventScroll: true });
	}, [focusToken]);

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
						// The direction follows the draft: Hebrew starts right,
						// English starts left. The card around it stays put.
						dir="auto"
						role="combobox"
						aria-expanded={slashOpen}
						aria-controls="slash-menu-listbox"
						aria-autocomplete="list"
						aria-activedescendant={slashOpen ? `slash-option-${slashIndex}` : undefined}
						className="max-h-(--composer-max-height) rounded-t-xl border-0 bg-transparent shadow-none focus-visible:border-transparent focus-visible:ring-0 md:text-base dark:bg-transparent"
					/>
					{attachments.length === 0 ? null : (
						<div
							data-slot="composer-attachments"
							className="flex flex-wrap gap-1 px-3 pb-1"
						>
							{attachments.map((entry) => (
								<span
									key={entry.key}
									className="inline-flex max-w-48 items-center gap-1 rounded-md border border-border bg-muted px-1.5 py-0.5"
									title={
										entry.status === "failed"
											? (entry.error ?? "refused")
											: entry.name
									}
								>
									<Text size="2xs" tone="muted" className="truncate">
										{entry.status === "uploading"
											? `Uploading ${entry.name}…`
											: entry.name}
									</Text>
									<Text size="2xs" tone="muted" className="shrink-0">
										{formatFileSize(entry.size)}
									</Text>
									<button
										type="button"
										aria-label={`Remove ${entry.name}`}
										onClick={() => onRemoveAttachment?.(entry.key)}
										className="shrink-0 text-muted-foreground hover:text-foreground"
									>
										<X className="size-3" aria-hidden />
									</button>
								</span>
							))}
						</div>
					)}
					<div className="flex flex-col gap-2 px-2 pb-2 sm:flex-row sm:items-end">
						<div className="order-2 flex min-w-0 flex-1 flex-wrap items-center gap-1 sm:order-1">
							{controls}
						</div>
						<div className="order-1 flex shrink-0 items-center gap-1 self-end sm:order-2 sm:self-auto">
							{onAttachFiles === undefined ? null : (
								<>
									<input
										ref={fileInput}
										type="file"
										multiple
										onChange={pickFiles}
										className="hidden"
										aria-hidden
										tabIndex={-1}
									/>
									<Button
										type="button"
										variant="ghost"
										size="icon"
										aria-label="Attach files"
										onClick={() => fileInput.current?.click()}
										disabled={disabled}
									>
										<Paperclip />
									</Button>
								</>
							)}
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
				{contextUsed === undefined ? null : (
					<div className="flex items-center gap-2 px-2 pt-1">
						<Text size="2xs" tone="muted" data-slot="composer-context">
							{formatContext(contextUsed, contextWindow)}
						</Text>
						{onCompact === undefined ||
						contextWindow === undefined ||
						contextUsed / contextWindow < 0.7 ? null : (
							<Button type="button" variant="outline" size="xs" onClick={onCompact}>
								Compact
							</Button>
						)}
					</div>
				)}
			</Measure>
		</div>
	);
}
