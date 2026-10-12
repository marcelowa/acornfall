import {
	useEffect,
	useRef,
	useState,
	type ChangeEvent,
	type KeyboardEvent,
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
} from "react";
import { ArrowUp, Paperclip, X } from "lucide-react";
import { Measure } from "@/components/layout/measure";
import { Text } from "@/components/typography/text";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { formatFileSize } from "@/lib/attachments";
import { formatContext } from "@/lib/format";
import { usePhone } from "@/lib/media";
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
	/** The pickers row: model, thinking, agent. Hidden while the card is folded — the folded row
	 * keeps `ambient` instead, so a dropped stream never hides with the pickers. */
	controls?: ReactNode | undefined;
	/** Ambient state shown above the card in both states: reconnecting, harness down. */
	ambient?: ReactNode | undefined;
	/** Folded: the phone's rest state — one row that says what it is, and no keyboard. The app owns
	 * the flag, so the draft and the fold survive the composer unmounting on a screen. */
	folded?: boolean | undefined;
	onFoldedChange?: ((folded: boolean) => void) | undefined;
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
 * coarse pointer Enter is always a newline too, so a phone never sends by accident. While a
 * run is live, sending with Enter does whatever the buttons offer: a steer when the worker can
 * steer, a queue when it cannot, and the line above the controls says which. While the slash
 * menu is open the arrows move its highlight, Enter picks it, and Escape dismisses it. What the
 * message means is the server's business.
 *
 * The draft prints at the size of the message it becomes (`text-lg`, 16px): it used to inherit
 * the primitive's `md:text-sm`, so the smallest print in the console was the text being typed.
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
	ambient,
	folded = false,
	onFoldedChange,
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
	/** The whole composer, used to tell a blur that stays inside it from one that leaves it. */
	const root = useRef<HTMLDivElement>(null);
	const [dragStart, setDragStart] = useState<number | undefined>(undefined);
	/** A tap on the folded row asked for the caret; it lands when the field exists. */
	const [openPending, setOpenPending] = useState(false);
	/** The fold is the phone layout: below `sm` the card rests folded. A desktop window narrowed
	 * that far is the phone layout, and answers the same way — which is also what makes the state
	 * reviewable in Storybook. */
	const folds = usePhone();
	const collapsed = folds && folded;
	/**
	 * Put the composing away: blur, and fold. This is what the swipe down the band calls, and
	 * what a tap on the transcript calls through the field's own blur — one path, so a fold can
	 * never happen without the keyboard going, or the other way round.
	 */
	const dismiss = (): void => {
		field.current?.blur();
		onFoldedChange?.(true);
	};
	/**
	 * Open the card and take the caret: the folded row's own tap, so the keyboard is asked for.
	 * The field does not exist yet on a fold, so the focus waits for it — in an effect, still
	 * inside the tap that asked for it, because a phone only opens its keyboard for a gesture.
	 */
	const open = (): void => {
		onFoldedChange?.(false);
		field.current?.focus({ preventScroll: true });
		setOpenPending(true);
	};
	useEffect(() => {
		if (!openPending || collapsed) return;
		setOpenPending(false);
		field.current?.focus({ preventScroll: true });
	}, [openPending, collapsed]);
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
		// On a phone a new conversation unfolds the card without taking the caret: the rule is
		// that the composer never pops the keyboard on its own (step 05), and a fold that hides
		// the field is the same rule from the other side.
		if (isCoarsePointer()) {
			onFoldedChange?.(false);
			return;
		}
		field.current?.focus({ preventScroll: true });
	}, [focusToken, onFoldedChange]);

	const submit = (): void => {
		if (!canSend) return;
		// Sending puts the composing away: the keyboard leaves and the card folds, so the message
		// that just landed is what the reader sees (J7).
		const sent = (): void => {
			field.current?.blur();
			onFoldedChange?.(true);
		};
		// While a run is live the landing is the worker's to offer: a steer joins the turn, and
		// when the worker cannot steer, queueing behind it is the only landing there is. Enter
		// does whichever one the composer is showing, so the line above the controls is true.
		if (running) {
			if (steerable) onSend();
			else onQueue();
			sent();
			return;
		}
		onSend();
		sent();
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

	/* The card's own controls: the attach picker, and whichever landing the run offers. Shared by
	 * the open card and the folded row — the folded row drops the picker, because a thumb that
	 * wants to attach can unfold it, and keeps every action, because Stop is the one control that
	 * must never be behind a tap. */
	const actions = (withAttach: boolean): ReactNode => (
		<div className="flex shrink-0 items-center gap-1">
			{onAttachFiles === undefined || !withAttach ? null : (
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
						variant="destructive"
						size="sm"
						onClick={onAbort}
						disabled={aborting}
					>
						Stop
					</Button>
					{steerable ? (
						<Button type="button" size="sm" onClick={onSteer} disabled={!canSend}>
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
	);

	const draftLine = value.trim() === "" ? undefined : (value.trim().split("\n")[0] ?? "");

	return (
		<div
			ref={root}
			data-slot="composer"
			data-folded={collapsed}
			className={cn(
				"w-full shrink-0 border-t border-border pb-[var(--keyboard-inset)]",
				className,
			)}
		>
			<Measure size="wide" padding="md">
				{above}
				{ambient}
				{collapsed ? (
					/* The folded row: the pill says the card is a sheet, the draft's own first line
					 * says what is in it, and every action stays. */
					<div className="relative rounded-xl border border-border bg-card shadow-sm">
						<span
							aria-hidden
							data-slot="composer-handle-pill"
							className="absolute -top-0.5 left-1/2 block h-1 w-10 -translate-x-1/2 rounded-full bg-muted-foreground/40"
						/>
						<div className="flex items-center gap-2 p-1.5 pl-3">
							<button
								type="button"
								data-slot="composer-open"
								aria-label="Write a message"
								onClick={open}
								className="min-w-0 flex-1 truncate rounded-md py-2 text-left text-lg outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
							>
								{draftLine === undefined ? (
									<span className="text-muted-foreground">{placeholder}</span>
								) : (
									draftLine
								)}
							</button>
							{actions(false)}
						</div>
						{attachments.length === 0 ? null : (
							<div className="px-3 pb-2">
								<Text size="2xs" tone="muted">
									{uploadingCount > 0
										? `${attachments.length} files · ${uploadingCount} uploading · send is off until they land`
										: `${attachments.length} files attached`}
								</Text>
							</div>
						)}
					</div>
				) : (
					<>
						{/* The band from the approved sketch: the pill plus the gap above the card,
						 * full card width and 44px tall, with `touch-none` so a drag is not the
						 * transcript's scroll. A phone's own gesture: on a wider layout the card
						 * keeps its height, because there is no keyboard to put away. */}
						{folds ? (
							<div
								data-slot="composer-handle"
								aria-hidden
								className="flex h-11 touch-none items-end justify-center"
								onPointerDown={(event: ReactPointerEvent<HTMLDivElement>) => {
									setDragStart(event.clientY);
									event.currentTarget.setPointerCapture(event.pointerId);
								}}
								onPointerMove={(event: ReactPointerEvent<HTMLDivElement>) => {
									if (dragStart === undefined) return;
									if (event.clientY - dragStart < 24) return;
									setDragStart(undefined);
									dismiss();
								}}
								onPointerUp={() => setDragStart(undefined)}
								onPointerCancel={() => setDragStart(undefined)}
							>
								<span className="block h-1 w-10 rounded-full bg-muted-foreground/40" />
							</div>
						) : null}
						<div className="rounded-xl border border-border bg-card shadow-sm transition-[border-color] focus-within:border-ring">
							<Textarea
								ref={field}
								value={value}
								onChange={(event) => onChange(event.target.value)}
								onKeyDown={onKeyDown}
								onFocus={() => onFoldedChange?.(false)}
								onBlur={(event) => {
									// Leaving the composer folds it. Moving between its own controls — a
									// picker, a chip's remove button — is not leaving it.
									const next = event.relatedTarget;
									if (
										next instanceof Node &&
										root.current?.contains(next) === true
									)
										return;
									onFoldedChange?.(true);
								}}
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
								aria-activedescendant={
									slashOpen ? `slash-option-${slashIndex}` : undefined
								}
								className="max-h-(--composer-max-height) rounded-t-xl border-0 bg-transparent text-lg shadow-none focus-visible:border-transparent focus-visible:ring-0 md:text-lg dark:bg-transparent"
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
							{running && !isCoarsePointer() ? (
								<div className="px-3 pb-1">
									<Text size="2xs" tone="muted">
										{steerable
											? "Enter steers this turn · Shift+Enter is a newline"
											: "Enter queues behind this turn · Shift+Enter is a newline"}
									</Text>
								</div>
							) : null}
							<div className="flex flex-col gap-2 px-2 pb-2 sm:flex-row sm:items-end">
								<div className="order-2 flex min-w-0 flex-1 flex-wrap items-center gap-1 sm:order-1">
									{controls}
								</div>
								<div className="order-1 self-end sm:order-2 sm:self-auto">
									{actions(true)}
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
										<Button
											type="button"
											variant="outline"
											size="xs"
											onClick={onCompact}
										>
											Compact
										</Button>
									)}
								</div>
							)}
						</div>
					</>
				)}
			</Measure>
		</div>
	);
}
