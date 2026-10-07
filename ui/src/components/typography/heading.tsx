import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * A heading is a level, not a font size: `1` renders an `h1` and the size that belongs to it,
 * so the document outline and the visual hierarchy cannot drift apart. The sizes are token
 * classes; there is no way to ask for 19px.
 */
const sizes = {
	1: "text-3xl",
	2: "text-2xl",
	3: "text-xl",
	4: "text-lg",
} as const;

const tags = { 1: "h1", 2: "h2", 3: "h3", 4: "h4" } as const;

export type HeadingLevel = keyof typeof sizes;

export interface HeadingProps {
	level?: HeadingLevel;
	className?: string;
	children: ReactNode;
}

export function Heading({ children, className, level = 2 }: HeadingProps) {
	const Tag = tags[level];
	return (
		<Tag
			className={cn("font-semibold tracking-tight text-foreground", sizes[level], className)}
		>
			{children}
		</Tag>
	);
}
