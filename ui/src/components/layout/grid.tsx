import type { ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { gapScale } from "./spacing";

const gridVariants = cva("grid", {
	variants: {
		columns: {
			"1": "grid-cols-1",
			"2": "grid-cols-2",
			"3": "grid-cols-3",
			"4": "grid-cols-4",
		},
		gap: gapScale,
	},
	defaultVariants: { columns: "2", gap: "md" },
});

export type GridProps = VariantProps<typeof gridVariants> & {
	className?: string;
	children: ReactNode;
};

export function Grid({ className, children, columns, gap }: GridProps) {
	return <div className={cn(gridVariants({ columns, gap }), className)}>{children}</div>;
}
