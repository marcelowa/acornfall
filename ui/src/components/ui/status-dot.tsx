import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";

/**
 * Live state, as a dot. The rail's rule from ADR 0009 survives: a dot is for what is
 * happening now (running) or what arrived since you looked (unread), and identity is text.
 * A dot says nothing to a screen reader on its own, so the label travels with it.
 */
const dotVariants = cva("inline-block shrink-0 rounded-full", {
	variants: {
		state: {
			running: "bg-primary animate-pulse",
			// A run that stopped moving keeps the dot but loses the accent and the pulse: the
			// slot stays, so the rail does not shift when a run dies, and the label stops
			// claiming life the run no longer shows.
			stale: "bg-muted-foreground",
			unread: "bg-success",
		},
		size: {
			sm: "size-1.5",
			default: "size-2",
		},
	},
	defaultVariants: {
		state: "running",
		size: "default",
	},
});

const labels = {
	running: "Running",
	stale: "Still marked running, but nothing has moved for half an hour",
	unread: "New since you last looked",
} as const;

export type StatusDotState = keyof typeof labels;

export interface StatusDotProps extends VariantProps<typeof dotVariants> {
	state?: StatusDotState | undefined;
	className?: string | undefined;
}

export function StatusDot({ state = "running", size, className }: StatusDotProps) {
	return (
		<span
			role="img"
			aria-label={labels[state]}
			title={labels[state]}
			className={cn(dotVariants({ state, size }), className)}
		/>
	);
}
