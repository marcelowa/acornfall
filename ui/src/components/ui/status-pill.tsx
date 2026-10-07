import { Badge } from "@/components/ui/badge";
import { cn } from "cn";

export type StatusPillState = "reconnecting" | "harness-down";

export interface StatusPillProps {
	state: StatusPillState;
	/** The reason, when there is one: the pill's title, and the inspector's business too. */
	detail?: string | undefined;
	className?: string | undefined;
}

/**
 * Ambient state, not an event: the stream is being re-established, or the harness is gone.
 * It renders nothing while everything is well — a "connected" badge is noise — and it stays
 * as long as the condition does, because it is a condition and not a thing that happened.
 */
export function StatusPill({ state, detail, className }: StatusPillProps) {
	return (
		<Badge
			data-slot="status-pill"
			data-state={state}
			variant="soft"
			tone={state === "harness-down" ? "danger" : "warning"}
			size="sm"
			title={detail}
			className={cn(className)}
		>
			{state === "harness-down" ? "harness down" : "reconnecting"}
		</Badge>
	);
}
