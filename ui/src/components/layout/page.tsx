import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

/**
 * The root surface. It paints the theme's background and text colour and fills its parent, so
 * no screen has to say either — and light/dark is a token swap below it, not a screen's
 * concern.
 */
export interface PageProps {
	className?: string;
	children: ReactNode;
}

export function Page({ className, children }: PageProps) {
	return (
		<div
			className={cn(
				"flex h-full min-h-0 w-full flex-col bg-background text-foreground",
				className,
			)}
		>
			{children}
		</div>
	);
}
