import { useEffect, useState } from "react";
import type { ProviderAuthType } from "@/app/client";
import type { AuthFlow } from "@/app/use-platform";
import type { ProviderSummary } from "@/app/view-models";
import type { WireAuthNotice } from "@/app/wire";
import { Stack } from "@/components/layout/stack";
import { Button } from "@/components/ui/button";
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
	onPickMethod?: ((method: ProviderAuthType) => void) | undefined;
	onAnswer?: ((value: string) => void) | undefined;
	onCancel?: (() => void) | undefined;
	onClose?: (() => void) | undefined;
	/** Back to the method choice after a failure. */
	onRetry?: (() => void) | undefined;
}

function methodLabel(method: ProviderAuthType): string {
	return method === "oauth" ? "Sign in" : "API key";
}

function Notice({ event }: { event: WireAuthNotice }) {
	switch (event.kind) {
		case "info":
			return (
				<Stack gap="2xs">
					<Text size="sm">{event.message}</Text>
					{(event.links ?? []).map((link) => (
						<a
							key={link.url}
							href={link.url}
							target="_blank"
							rel="noreferrer"
							className="text-sm text-primary underline"
						>
							{link.label ?? link.url}
						</a>
					))}
				</Stack>
			);
		case "auth_url":
			return (
				<Stack gap="2xs">
					{event.instructions === undefined ? null : (
						<Text size="sm">{event.instructions}</Text>
					)}
					<a
						href={event.url}
						target="_blank"
						rel="noreferrer"
						className="text-sm text-primary underline"
					>
						Open the sign-in page
					</a>
				</Stack>
			);
		case "device_code":
			return (
				<Stack gap="2xs">
					<Text size="sm">
						Enter this code at{" "}
						<a
							href={event.verificationUri}
							target="_blank"
							rel="noreferrer"
							className="text-primary underline"
						>
							{event.verificationUri}
						</a>
					</Text>
					<span className="flex items-center gap-2">
						<Text as="span" size="lg" weight="semibold" className="font-mono">
							{event.userCode}
						</Text>
						<CopyButton value={event.userCode} />
					</span>
				</Stack>
			);
		case "progress":
			return (
				<Text size="sm" tone="muted">
					{event.message}
				</Text>
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
						className="justify-start"
						disabled={flow.answering}
						onClick={() => onAnswer?.(option.id)}
					>
						<span className="flex min-w-0 flex-col items-start">
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
			disabled={flow.answering}
			onAnswer={onAnswer}
		/>
	);
}

function AnswerField({
	message,
	placeholder,
	secret,
	disabled,
	onAnswer,
}: {
	message: string;
	placeholder?: string | undefined;
	secret: boolean;
	disabled: boolean;
	onAnswer: ((value: string) => void) | undefined;
}) {
	const [value, setValue] = useState("");
	// One field per prompt: a second prompt is a second question, not an edit.
	useEffect(() => {
		setValue("");
	}, [message]);
	const submit = (): void => {
		if (value === "" || disabled) return;
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
					disabled={value === "" || disabled}
					onClick={submit}
				>
					{disabled ? "Sending" : "Send"}
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

	return (
		<Dialog
			open={open}
			onOpenChange={(next) => {
				if (!next) {
					// Closing mid-flow aborts it; closing a finished one dismisses it.
					if (flow !== undefined && outcome === undefined) onCancel?.();
					else if (pending !== undefined && flow === undefined) onCancel?.();
					else onClose?.();
				}
			}}
		>
			<DialogContent className="sm:max-w-md">
				<DialogHeader>
					<DialogTitle>Connect {provider?.name ?? "provider"}</DialogTitle>
					<DialogDescription>
						{outcome?.ok === true
							? "The key works. Its models are in the picker now."
							: "The key is stored on this install, for every workspace."}
					</DialogDescription>
				</DialogHeader>
				{flow === undefined && pending !== undefined ? (
					<Stack gap="sm">
						{pending.authTypes.map((method) => (
							<Button
								key={method}
								type="button"
								variant="outline"
								className="justify-start"
								onClick={() => onPickMethod?.(method)}
							>
								{methodLabel(method)}
								<Text as="span" size="2xs" tone="muted" className="ml-auto">
									{method === "oauth"
										? "sign in with the provider"
										: "paste a key"}
								</Text>
							</Button>
						))}
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
								{flow.notices.map((notice, index) => (
									<Notice key={`${notice.kind}-${index}`} event={notice} />
								))}
								{flow.prompt === undefined && flow.notices.length === 0 ? (
									<Text size="sm" tone="muted">
										Starting {methodLabel(flow.method).toLowerCase()}…
									</Text>
								) : null}
								<Prompt flow={flow} onAnswer={onAnswer} />
							</>
						)}
					</Stack>
				) : null}
				<DialogFooter>
					{outcome?.ok === true || (outcome !== undefined && outcome.ok === false) ? (
						<Button type="button" onClick={() => onClose?.()}>
							Close
						</Button>
					) : (
						<Button type="button" variant="ghost" onClick={() => onCancel?.()}>
							Cancel
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
}
