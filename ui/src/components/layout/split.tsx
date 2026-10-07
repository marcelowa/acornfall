import type { ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";
import { gapScale } from "./spacing";

/**
 * A fixed rail and the pane beside it. The rail's width is `--rail-width` from the tokens,
 * reached through a `var()` grid template because Tailwind has no width namespace in which a
 * token could be named. That reference is a token, not an invented value — which is why
 * `check-system` allows a bracket that only contains `var()`, and nothing else.
 */
const splitVariants = cva(
	"grid min-h-0 w-full flex-1 grid-cols-[var(--rail-width)_minmax(0,1fr)]",
	{
		variants: {
			gap: gapScale,
		},
		defaultVariants: { gap: "none" },
	},
);

export type SplitProps = VariantProps<typeof splitVariants> & {
	aside: ReactNode;
	className?: string;
	children: ReactNode;
};

export function Split({ aside, className, children, gap }: SplitProps) {
	return (
		<div className={cn(splitVariants({ gap }), className)}>
			<aside className="flex min-h-0 min-w-0 flex-col">{aside}</aside>
			<div className="flex min-h-0 min-w-0 flex-col">{children}</div>
		</div>
	);
}
