import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * Live state, as a dot. The rail's rule from ADR 0009 survives: a dot is for what is
 * happening now (running) or what arrived since you looked (unread), and identity is text.
 * A dot says nothing to a screen reader on its own, so the label travels with it.
 */
const dotVariants = cva("inline-block shrink-0 rounded-full", {
	variants: {
		state: {
			running: "bg-primary animate-pulse",
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
