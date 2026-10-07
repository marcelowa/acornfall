import type { ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

/**
 * A readable measure. Text that runs the full width of a 27-inch screen is not more
 * information, it is harder to read. The transcript and the composer align to the same one,
 * and the width is a token rather than a class a screen invents.
 */
const measureVariants = cva("mx-auto flex w-full shrink-0 flex-col", {
	variants: {
		size: {
			prose: "max-w-3xl",
			page: "max-w-page",
		},
		padding: {
			none: "",
			sm: "px-4",
			md: "px-4 py-2 lg:px-6",
			lg: "px-4 py-6 lg:px-6",
		},
	},
	defaultVariants: {
		size: "prose",
		padding: "none",
	},
});

export type MeasureProps = VariantProps<typeof measureVariants> & {
	className?: string | undefined;
	children: ReactNode;
};

export function Measure({ size, padding, className, children }: MeasureProps) {
	return <div className={cn(measureVariants({ size, padding }), className)}>{children}</div>;
}
