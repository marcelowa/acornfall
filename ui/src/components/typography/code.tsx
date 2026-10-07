import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface CodeProps {
	className?: string;
	children: ReactNode;
}

export function Code({ className, children }: CodeProps) {
	return (
		<code
			className={cn(
				"rounded-sm bg-muted px-1.5 py-0.5 font-mono text-sm text-foreground",
				className,
			)}
		>
			{children}
		</code>
	);
}
