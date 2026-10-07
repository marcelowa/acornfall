import type { ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";

/**
 * A readable measure. Text that runs the full width of a 27-inch screen is harder to read,
 * but this interface is mostly code, tool output, and diffs — content that a prose column
 * wastes space on. Three widths, then: `prose` for a text-only context, `wide` for the
 * transcript and the composer, `page` for a surface that owns its whole screen. The pane
 * constrains whichever one is asked for, so a phone just gets the full width.
 */
const measureVariants = cva("mx-auto flex w-full shrink-0 flex-col", {
	variants: {
		size: {
			prose: "max-w-3xl",
			wide: "max-w-5xl",
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
