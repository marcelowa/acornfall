import type { ElementType, ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { gapScale, paddingScale } from "./spacing";

/**
 * The vertical/horizontal stack. It exists so a screen can arrange things without a class:
 * direction, gap, alignment, padding, fill, and scroll are the whole vocabulary, and each one
 * is a preset over tokens. When a screen needs something not here, the answer is a variant,
 * not a className.
 */
const stackVariants = cva("flex", {
	variants: {
		direction: {
			vertical: "flex-col",
			horizontal: "flex-row",
		},
		gap: gapScale,
		align: {
			start: "items-start",
			center: "items-center",
			end: "items-end",
			stretch: "items-stretch",
			baseline: "items-baseline",
		},
		justify: {
			start: "justify-start",
			center: "justify-center",
			end: "justify-end",
			between: "justify-between",
		},
		padding: paddingScale,
		scroll: {
			none: "",
			// Children of a scroll container must not compress: in a flex column an item with
			// overflow is free to shrink to nothing, and it takes a long conversation to notice.
			vertical: "overflow-y-auto [&>*]:shrink-0",
			horizontal: "overflow-x-auto [&>*]:shrink-0",
		},
		fill: {
			true: "min-h-0 min-w-0 flex-1",
			false: "",
		},
	},
	defaultVariants: {
		direction: "vertical",
		gap: "sm",
		align: "stretch",
		justify: "start",
		padding: "none",
		scroll: "none",
		fill: false,
	},
});

export type StackProps = VariantProps<typeof stackVariants> & {
	as?: ElementType;
	className?: string;
	children: ReactNode;
};

export function Stack({
	as: Comp = "div",
	className,
	children,
	direction,
	gap,
	align,
	justify,
	padding,
	scroll,
	fill,
}: StackProps) {
	return (
		<Comp
			className={cn(
				stackVariants({ direction, gap, align, justify, padding, scroll, fill }),
				className,
			)}
		>
			{children}
		</Comp>
	);
}
