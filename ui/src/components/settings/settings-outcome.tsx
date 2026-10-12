import { Text } from "@/components/typography/text";

export interface SettingsOutcomeProps {
	/** `undefined` until the field's own commit is asked for. */
	state: "pending" | "applied" | "refused" | undefined;
	/** The server's words, for a refusal. */
	message?: string | undefined;
}

/**
 * What happened to the change a field owns, next to the field. It exists because the outcome of
 * a commit is a state a reader has to be able to tell apart at a glance: "applied" and "refused"
 * looked the same when the only evidence was the value in the box, and a refusal that appeared
 * only in the strip at the top of the pane left the field looking fine.
 *
 * The states are their own component so every one of them has a story, and so a page cannot
 * invent a fourth.
 */
export function SettingsOutcome({ state, message }: SettingsOutcomeProps) {
	if (state === undefined) return null;
	if (state === "applied") {
		return (
			<Text as="p" size="2xs" className="text-success-subtle-foreground">
				Applied — takes effect at the next sandbox
			</Text>
		);
	}
	if (state === "pending") {
		return (
			<Text as="p" size="2xs" tone="muted">
				Applying…
			</Text>
		);
	}
	return (
		<Text as="p" size="2xs" className="text-destructive-subtle-foreground">
			Refused: {message}
		</Text>
	);
}
