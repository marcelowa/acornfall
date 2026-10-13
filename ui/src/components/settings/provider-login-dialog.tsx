import { useEffect, useState } from "react";
import type { ReactNode } from "react";
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
			{/* A link on a phone is still a target: the panel measured it at 37×21, the only control
			    under 44px in these flows. The button's own ladder carries the phone step. */}
			<Button asChild variant="link" size="sm" className="shrink-0">
				<a href={url} target="_blank" rel="noreferrer">
					{label}
				</a>
			</Button>
		</span>
	);
}

/**
 * The rows a notice puts on screen: an address, a code, a link. They are what the person acts
 * on, and they sit in the same slot in every state — under the words, above the action.
 */
function noticeControls(notice: AuthNotice) {
	switch (notice.kind) {
		case "info":
			return (
				<>
					{(notice.links ?? []).map((link) => (
						<Address key={link.url} url={link.url} label={link.label ?? "Open"} />
					))}
				</>
			);
		case "auth_url":
			return <Address url={notice.url} />;
		case "device_code":
			return (
				<>
					<span className="flex items-center gap-2">
						<Text as="span" size="lg" weight="semibold" className="font-mono">
							{notice.userCode}
						</Text>
						<CopyButton value={notice.userCode} label="Copy code" />
					</span>
					<Address url={notice.verificationUri} />
				</>
			);
	}
}

/** The words a notice asks with, when no prompt says it better. */
function noticeAsk(notice: AuthNotice): string | undefined {
	switch (notice.kind) {
		case "info":
			return notice.message;
		case "auth_url":
			return notice.instructions ?? "Open this address to finish signing in.";
		case "device_code":
			return "Enter this code where the provider asks:";
	}
}

/**
 * Connecting a provider, as a dialog: the method first, then whatever the provider asks for — a
 * key, a choice, a page to open, a code to copy. Prompts and notices arrive on the stream, so
 * the dialog renders what is here and waits for the rest. Cancelling aborts the server flow too,
 * not just the dialog: a dialog that only hides would leave a sign-in running behind it.
 *
 * The dialog is a frame with three slots, and every state fills the same ones: **the ask** (one
 * line of words, in the provider's own voice), **the controls** (what the person acts on — the
 * method buttons, an address, a code, the field), and **the action** (one full-width button, the
 * last thing in the body). A state change then moves nothing but the words: the owner's finding
 * was that connecting — choice, then the provider's question, then the address and the paste —
 * rearranged the whole panel at every step. The body keeps a minimum height for the same reason,
 * so the frame does not resize between states.
 *
 * While a flow runs, a tap outside does nothing and the X is gone: the only way out is the
 * Cancel button. A stray tap on a phone must not end a sign-in half done.
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
	const prompt = flow?.prompt;
	/** The method being started, and why it did not: the flow's own state arrives later. */
	const [starting, setStarting] = useState<ProviderAuthType | undefined>(undefined);
	const [startError, setStartError] = useState<string | undefined>(undefined);
	/** The answer to the waiting prompt. One field per prompt: a second prompt is a new question. */
	const [answer, setAnswer] = useState("");

	// A new provider is a new question: the last attempt's state does not belong to it.
	useEffect(() => {
		setStarting(undefined);
		setStartError(undefined);
	}, [pending?.id]);
	useEffect(() => {
		setAnswer("");
	}, [prompt?.promptId]);

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

	const submit = (): void => {
		if (prompt === undefined || flow?.answering === true) return;
		// A text prompt may accept a blank answer on purpose — "GitHub Enterprise URL/domain
		// (blank for github.com)" is one — while a key or a code is never blank.
		if (answer === "" && prompt.promptType !== "text") return;
		onAnswer?.(answer);
	};

	// With nothing else to say, the flow says where it is: starting, or finishing what was
	// answered or taken over. A provider's own line wins when it has one. A device code is the
	// exception: it is the question, and the flow waits for the person until it ends.
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

	// The three slots. Only their contents change between states.
	let ask: ReactNode;
	let controls: ReactNode;
	let action: ReactNode;
	if (flow === undefined && pending !== undefined) {
		ask =
			starting === undefined ? (
				startError === undefined ? undefined : (
					<Text size="sm" tone="muted" className="wrap-anywhere">
						Could not start: {startError}
					</Text>
				)
			) : (
				<Text size="sm" tone="muted">
					Starting {methodLabel(starting).toLowerCase()}…
				</Text>
			);
		controls = (
			<Stack gap="2xs">
				{pending.authTypes.map((method) => (
					<Button
						key={method}
						type="button"
						variant="outline"
						// A choice is a sentence, not a word: it wraps, and it grows instead of
						// clipping the answer it offers.
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
			</Stack>
		);
		action = undefined;
	} else if (flow !== undefined) {
		if (outcome?.ok === true) {
			ask = <Text size="sm">{flow.provider.name} connected.</Text>;
		} else if (outcome !== undefined) {
			ask = (
				<Stack gap="2xs">
					<Text size="sm" weight="medium">
						Could not connect.
					</Text>
					<Text size="sm" className="wrap-anywhere">
						{outcome.message}
					</Text>
				</Stack>
			);
			action = (
				<Button
					type="button"
					variant="outline"
					// Pinned to the bottom of the body's frame: the action is in the same place in
					// every state, whatever is above it.
					className="mt-auto w-full"
					onClick={() => onRetry?.()}
				>
					Try again
				</Button>
			);
		} else {
			// The ask: the provider's own question when it has one, else its instructions, else
			// the flow's own line. The prompt says what the notice says better, so only one of
			// them is the ask.
			const asked = prompt === undefined ? undefined : prompt.message;
			const instructions = flow.notices
				.map((notice) => noticeAsk(notice))
				.filter((line): line is string => line !== undefined)
				.join(" ");
			ask = (
				<>
					{asked === undefined && instructions !== "" ? (
						<Text size="sm" className="wrap-anywhere">
							{instructions}
						</Text>
					) : null}
					{asked === undefined ? null : (
						<Text size="sm" weight="medium" className="wrap-anywhere">
							{asked}
						</Text>
					)}
					{status === undefined ? null : (
						<Text size="sm" tone="muted" className="wrap-anywhere">
							{status}
						</Text>
					)}
				</>
			);
			// The controls: what to read or act on — the addresses and codes, then the choices,
			// then the field. The address comes before the field because the flow needs the
			// address finished first.
			controls = (
				<>
					{flow.notices.map((notice) => (
						<Stack key={noticeKey(notice)} gap="2xs">
							{noticeControls(notice)}
						</Stack>
					))}
					{prompt?.promptType === "select" ? (
						<Stack gap="2xs">
							{(prompt.options ?? []).map((option) => (
								<Button
									key={option.id}
									type="button"
									variant="outline"
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
					) : null}
					{prompt === undefined || prompt.promptType === "select" ? null : (
						<Input
							value={answer}
							type={
								prompt.promptType === "secret" ||
								prompt.promptType === "manual_code"
									? "password"
									: "text"
							}
							autoFocus
							autoComplete="off"
							spellCheck={false}
							placeholder={prompt.placeholder}
							aria-label={prompt.message}
							disabled={flow.answering}
							onChange={(event) => setAnswer(event.target.value)}
							onKeyDown={(event) => {
								if (event.key !== "Enter") return;
								event.preventDefault();
								submit();
							}}
						/>
					)}
				</>
			);
			// The action: one button, full width, the last thing in the body — the same place a
			// choice, a paste and a retry all land.
			action =
				prompt === undefined || prompt.promptType === "select" ? undefined : (
					<Button
						type="button"
						// Pinned to the bottom of the body's frame: the action is in the same place in
						// every state, whatever is above it.
						className="mt-auto w-full"
						disabled={flow.answering || (answer === "" && prompt.promptType !== "text")}
						onClick={submit}
					>
						{flow.answering
							? prompt.promptType === "secret"
								? "Saving…"
								: "Checking…"
							: prompt.promptType === "secret"
								? "Save"
								: "Continue"}
					</Button>
				);
		}
	}

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
				<Stack gap="sm" className="min-h-[var(--connect-body-min)]">
					{ask}
					{controls}
					{action}
				</Stack>
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

function noticeKey(notice: AuthNotice): string {
	if (notice.kind === "auth_url") return `url-${notice.url}`;
	if (notice.kind === "device_code") return `code-${notice.userCode}`;
	return `info-${notice.message}`;
}
