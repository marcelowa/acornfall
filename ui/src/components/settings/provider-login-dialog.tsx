import { useEffect, useState } from "react";
import type { AuthFlow, AuthNotice } from "@/app/auth-flow";
import type { ProviderAuthType } from "@/app/client";
import type { ProviderSummary } from "@/app/view-models";
import { Stack } from "@/components/layout/stack";
import { Button } from "@/components/ui/button";
import { ClippedText } from "@/components/ui/clipped-text";
import { CopyButton } from "@/components/ui/copy-button";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/typography/text";

export interface ProviderLoginDialogProps {
	/** The provider being connected, before the flow starts. */
	pending?: ProviderSummary | undefined;
	/** The running flow, once started. */
	flow?: AuthFlow | undefined;
	/** A refusal rejects, so the dialog can say so where the method was chosen. */
	onPickMethod?: ((method: ProviderAuthType) => void | Promise<void>) | undefined;
	onAnswer?: ((value: string) => void) | undefined;
	onCancel?: (() => void) | undefined;
	onClose?: (() => void) | undefined;
	/** Back to the method choice after a failure. */
	onRetry?: (() => void) | undefined;
}

function methodLabel(method: ProviderAuthType): string {
	return method === "oauth" ? "Sign in" : "API key";
}

function methodHint(method: ProviderAuthType): string {
	return method === "oauth" ? "sign in with the provider" : "paste a key";
}

/**
 * An address the person has to reach, shown whole: copyable and openable. A headless sign-in
 * is the normal case here, not the fallback — the console is often open on a phone or another
 * machine, and the provider's loopback callback lands on the machine running the worker — so
 * the address has to be text that can leave this page, not only a link that opens here.
 */
function Address({ url, label = "Open" }: { url: string; label?: string | undefined }) {
	return (
		<span className="flex min-w-0 flex-wrap items-center gap-2">
			<span className="min-w-0 flex-1">
				<ClippedText text={url} className="font-mono text-2xs text-muted-foreground" />
			</span>
			<CopyButton value={url} label="Copy address" />
			<a
				href={url}
				target="_blank"
				rel="noreferrer"
				className="text-sm text-primary underline"
			>
				{label}
			</a>
		</span>
	);
}

function noticeKey(notice: AuthNotice): string {
	if (notice.kind === "auth_url") return `url-${notice.url}`;
	if (notice.kind === "device_code") return `code-${notice.userCode}`;
	return `info-${notice.message}`;
}

function Notice({ event }: { event: AuthNotice }) {
	switch (event.kind) {
		case "info":
			return (
				<Stack gap="2xs">
					<Text size="sm">{event.message}</Text>
					{(event.links ?? []).map((link) => (
						<Address key={link.url} url={link.url} label={link.label ?? "Open"} />
					))}
				</Stack>
			);
		case "auth_url":
			return (
				<Stack gap="2xs">
					<Text size="sm">
						{event.instructions ?? "Open this address to finish signing in."}
					</Text>
					<Address url={event.url} />
				</Stack>
			);
		case "device_code":
			return (
				<Stack gap="2xs">
					<Text size="sm">Enter this code where the provider asks:</Text>
					<span className="flex items-center gap-2">
						<Text as="span" size="lg" weight="semibold" className="font-mono">
							{event.userCode}
						</Text>
						<CopyButton value={event.userCode} label="Copy code" />
					</span>
					<Address url={event.verificationUri} />
				</Stack>
			);
	}
}

function Prompt({
	flow,
	onAnswer,
}: {
	flow: AuthFlow;
	onAnswer: ((value: string) => void) | undefined;
}) {
	const prompt = flow.prompt;
	if (prompt === undefined) return null;
	if (prompt.promptType === "select") {
		return (
			<Stack gap="2xs">
				<Text size="sm" weight="medium">
					{prompt.message}
				</Text>
				{(prompt.options ?? []).map((option) => (
					<Button
						key={option.id}
						type="button"
						variant="outline"
						// A choice is a sentence, not a word: it wraps, and it grows instead of
						// clipping the answer it offers.
						className="h-auto justify-start py-2 whitespace-normal"
						disabled={flow.answering}
						onClick={() => onAnswer?.(option.id)}
					>
						<span className="flex min-w-0 flex-col items-start gap-0.5">
							<span>{option.label}</span>
							{option.description === undefined ? null : (
								<Text as="span" size="2xs" tone="muted">
									{option.description}
								</Text>
							)}
						</span>
					</Button>
				))}
			</Stack>
		);
	}
	return (
		<AnswerField
			key={prompt.promptId}
			message={prompt.message}
			placeholder={prompt.placeholder}
			secret={prompt.promptType === "secret" || prompt.promptType === "manual_code"}
			// A text prompt may accept a blank answer on purpose — "GitHub Enterprise URL/domain
			// (blank for github.com)" is one — while a key or a code is never blank.
			allowEmpty={prompt.promptType === "text"}
			// A pasted code or redirect URL is continued with, a key is saved: the button says
			// which, because the two mean different things to the flow behind it.
			action={prompt.promptType === "secret" ? "Save" : "Continue"}
			busy={prompt.promptType === "secret" ? "Saving" : "Checking"}
			disabled={flow.answering}
			onAnswer={onAnswer}
		/>
	);
}

function AnswerField({
	message,
	placeholder,
	secret,
	allowEmpty,
	action,
	busy,
	disabled,
	onAnswer,
}: {
	message: string;
	placeholder?: string | undefined;
	secret: boolean;
	allowEmpty: boolean;
	action: string;
	busy: string;
	disabled: boolean;
	onAnswer: ((value: string) => void) | undefined;
}) {
	const [value, setValue] = useState("");
	// One field per prompt: a second prompt is a second question, not an edit.
	useEffect(() => {
		setValue("");
	}, [message]);
	const submit = (): void => {
		if (disabled) return;
		if (value === "" && !allowEmpty) return;
		onAnswer?.(value);
	};
	return (
		<Stack gap="2xs">
			<Text size="sm" weight="medium">
				{message}
			</Text>
			<span className="flex items-center gap-2">
				<Input
					value={value}
					type={secret ? "password" : "text"}
					autoFocus
					autoComplete="off"
					spellCheck={false}
					placeholder={placeholder}
					aria-label={message}
					disabled={disabled}
					onChange={(event) => setValue(event.target.value)}
					onKeyDown={(event) => {
						if (event.key !== "Enter") return;
						event.preventDefault();
						submit();
					}}
				/>
				<Button
					type="button"
					size="sm"
					disabled={disabled || (value === "" && !allowEmpty)}
					onClick={submit}
				>
					{disabled ? `${busy}…` : action}
				</Button>
			</span>
		</Stack>
	);
}

/**
 * Connecting a provider, as a dialog: the method first, then whatever the provider asks
 * for — a key, a choice, a page to open, a code to copy. Prompts and notices arrive on
 * the stream, so the dialog renders what is here and waits for the rest. Cancelling
 * aborts the server flow too, not just the dialog: a dialog that only hides would leave
 * a sign-in running behind it.
 *
 * While a flow runs, a tap outside does nothing and the X is gone: the only way out is the
 * Cancel button. A stray tap on a phone must not end a sign-in half done, and "outside" is
 * where the person taps when the page is not the dialog.
 */
export function ProviderLoginDialog({
	pending,
	flow,
	onPickMethod,
	onAnswer,
	onCancel,
	onClose,
	onRetry,
}: ProviderLoginDialogProps) {
	const open = pending !== undefined || flow !== undefined;
	const provider = flow?.provider ?? pending;
	const outcome = flow?.outcome;
	const live = flow !== undefined && outcome === undefined;
	/** The method being started, and why it did not: the flow's own state arrives later. */
	const [starting, setStarting] = useState<ProviderAuthType | undefined>(undefined);
	const [startError, setStartError] = useState<string | undefined>(undefined);

	// A new provider is a new question: the last attempt's state does not belong to it.
	useEffect(() => {
		setStarting(undefined);
		setStartError(undefined);
	}, [pending?.id]);

	const close = (): void => {
		if (flow === undefined || outcome === undefined) onCancel?.();
		else onClose?.();
	};

	const pick = (method: ProviderAuthType): void => {
		setStartError(undefined);
		setStarting(method);
		void Promise.resolve(onPickMethod?.(method)).catch((cause: unknown) => {
			setStarting(undefined);
			setStartError(cause instanceof Error ? cause.message : String(cause));
		});
	};

	// With nothing else to say, the flow says where it is: starting, or finishing what was
	// answered or taken over. A provider's own line wins when it has one. A device code is the
	// exception: it is the question, and the flow is waiting for the person until it ends, so
	// no line is added under it.
	const waitingOnCode = flow?.notices.some((notice) => notice.kind === "device_code") ?? false;
	const status =
		flow === undefined || outcome !== undefined
			? undefined
			: (flow.progress ??
				(flow.prompt === undefined && !waitingOnCode
					? flow.answered
						? flow.method === "oauth"
							? "Finishing sign-in…"
							: "Saving the key…"
						: `Starting ${methodLabel(flow.method).toLowerCase()}…`
					: undefined));

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) close();
			}}
		>
			<DialogContent
				className="sm:max-w-md"
				showCloseButton={!live}
				onInteractOutside={(event) => {
					if (live) event.preventDefault();
				}}
			>
				<DialogHeader>
					<DialogTitle>Connect {provider?.name ?? "provider"}</DialogTitle>
					<DialogDescription>
						{outcome?.ok === true
							? "Connected. Its models are in the picker now."
							: "A key or a sign-in is stored on this install, for every workspace."}
					</DialogDescription>
				</DialogHeader>
				{flow === undefined && pending !== undefined ? (
					<Stack gap="sm">
						{pending.authTypes.map((method) => (
							<Button
								key={method}
								type="button"
								variant="outline"
								className="h-auto justify-start py-2 whitespace-normal"
								disabled={starting !== undefined}
								onClick={() => pick(method)}
							>
								<span className="flex min-w-0 flex-col items-start gap-0.5">
									<span>{methodLabel(method)}</span>
									<Text as="span" size="2xs" tone="muted">
										{methodHint(method)}
									</Text>
								</span>
							</Button>
						))}
						{starting === undefined ? null : (
							<Text size="sm" tone="muted">
								Starting {methodLabel(starting).toLowerCase()}…
							</Text>
						)}
						{startError === undefined ? null : (
							<Text size="sm" tone="muted">
								Could not start: {startError}
							</Text>
						)}
					</Stack>
				) : flow !== undefined ? (
					<Stack gap="sm">
						{outcome?.ok === true ? (
							<Text size="sm">{flow.provider.name} connected.</Text>
						) : outcome !== undefined ? (
							<Stack gap="2xs">
								<Text size="sm" weight="medium">
									Could not connect.
								</Text>
								<Text size="sm">{outcome.message}</Text>
								<span className="flex gap-2">
									<Button
										type="button"
										variant="outline"
										size="sm"
										onClick={() => onRetry?.()}
									>
										Try again
									</Button>
								</span>
							</Stack>
						) : (
							<>
								{flow.notices.map((notice) => (
									<Notice key={noticeKey(notice)} event={notice} />
								))}
								{status === undefined ? null : (
									<Text size="sm" tone="muted">
										{status}
									</Text>
								)}
								<Prompt flow={flow} onAnswer={onAnswer} />
							</>
						)}
					</Stack>
				) : null}
				<DialogFooter>
					{flow === undefined ? (
						<Button type="button" variant="ghost" onClick={() => onCancel?.()}>
							Cancel
						</Button>
					) : outcome === undefined ? (
						<Button type="button" variant="ghost" onClick={() => onCancel?.()}>
							Cancel sign-in
						</Button>
					) : (
						<Button type="button" onClick={() => onClose?.()}>
							Close
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
