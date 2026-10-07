import type { ReactNode } from "react";
import { cn } from "cn";

/**
 * The root surface. It paints the theme's background and text colour and fills its parent, so
 * no screen has to say either — and light/dark is a token swap below it, not a screen's
 * concern. It never scrolls: a pane that can grow owns its own scroll, because a page that
 * scrolls moves every panel at once, including the ones that were meant to stay put.
 */
export interface PageProps {
	className?: string;
	children: ReactNode;
}

export function Page({ className, children }: PageProps) {
	return (
		<div
			className={cn(
				"flex h-full min-h-0 w-full flex-col overflow-hidden bg-background text-foreground",
				className,
			)}
		>
			{children}
		</div>
	);
}
