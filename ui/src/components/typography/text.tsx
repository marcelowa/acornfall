import type { ElementType, ReactNode } from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const textVariants = cva("", {
	variants: {
		size: {
			"2xs": "text-2xs",
			xs: "text-xs",
			sm: "text-sm",
			base: "text-base",
			lg: "text-lg",
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
};

export function Text({ as: Comp = "p", className, children, size, tone, weight }: TextProps) {
	return <Comp className={cn(textVariants({ size, tone, weight }), className)}>{children}</Comp>;
}
