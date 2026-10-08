import type { ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { gapScale } from "./spacing";

/**
 * The fixed grid. Columns are token classes at every width, so a grid that must survive a
 * phone says so up front: `sm` and `md` override the base count at those breakpoints, and
 * omitting them keeps one count everywhere.
 */
const gridVariants = cva("grid", {
	variants: {
		columns: {
			"1": "grid-cols-1",
			"2": "grid-cols-2",
			"3": "grid-cols-3",
			"4": "grid-cols-4",
		},
		sm: {
			"1": "sm:grid-cols-1",
			"2": "sm:grid-cols-2",
			"3": "sm:grid-cols-3",
			"4": "sm:grid-cols-4",
		},
		md: {
			"1": "md:grid-cols-1",
			"2": "md:grid-cols-2",
			"3": "md:grid-cols-3",
			"4": "md:grid-cols-4",
		},
		gap: gapScale,
	},
	defaultVariants: { columns: "2", gap: "md" },
});

export type GridProps = VariantProps<typeof gridVariants> & {
	className?: string;
	children: ReactNode;
};

export function Grid({ className, children, columns, sm, md, gap }: GridProps) {
	return <div className={cn(gridVariants({ columns, sm, md, gap }), className)}>{children}</div>;
}
