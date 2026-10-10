import type { ElementType, ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";

const textVariants = cva("", {
	variants: {
		size: {
			"2xs": "text-2xs",
			xs: "text-xs",
			sm: "text-sm",
			base: "text-base",
			lg: "text-lg",
			xl: "text-xl",
		},
		tone: {
			default: "text-foreground",
			muted: "text-muted-foreground",
		},
		weight: {
			normal: "font-normal",
			medium: "font-medium",
			semibold: "font-semibold",
		},
	},
	defaultVariants: { size: "base", tone: "default", weight: "normal" },
});

export type TextProps = VariantProps<typeof textVariants> & {
	as?: ElementType;
	className?: string;
	children: ReactNode;
	/** Text direction. `auto` reads it from the first strong character,
	 * so Hebrew starts right and English starts left. */
	dir?: "auto" | "ltr" | "rtl" | undefined;
};

export function Text({ as: Comp = "p", className, children, size, tone, weight, dir }: TextProps) {
	return (
		<Comp dir={dir} className={cn(textVariants({ size, tone, weight }), className)}>
			{children}
		</Comp>
	);
}
