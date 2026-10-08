import { cn } from "cn";

export interface FactProps {
	label: string;
	value: string;
	tone?: "danger" | undefined;
	className?: string | undefined;
}

/**
 * One inspector fact: a fixed label column and a wrapping value. An empty value renders
 * nothing — a blank row is not information. Shared by every panel that answers "what is
 * true right now", so the three copies of it became one.
 */
export function Fact({ label, value, tone, className }: FactProps) {
	if (value === "") return null;
	return (
		<div className={cn("flex gap-2 text-xs", className)}>
			<span className="w-20 shrink-0 text-muted-foreground">{label}</span>
			<span
				className={cn(
					"min-w-0 break-all tabular-nums",
					tone === "danger" && "text-destructive",
				)}
			>
				{value}
			</span>
		</div>
	);
}
