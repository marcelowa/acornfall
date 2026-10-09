import { cn } from "cn";

/**
 * The three dots: the promise that something is coming. Shared by the live assistant
 * pane, the live thinking card, and running tool cards, so every live surface pulses
 * the same way. With a label it is a status; without, decoration beside words that
 * already say what is happening.
 */
export function ThinkingDots({ label, className }: { label?: string | undefined; className?: string | undefined }) {
	const dots = [0, 1, 2].map((dot) => (
		<span
			key={dot}
			aria-hidden
			className="size-1.5 rounded-full bg-muted-foreground motion-safe:animate-pulse"
			style={{ animationDelay: `${dot * 150}ms` }}
		/>
	));
	if (label === undefined) return <span className={cn("flex items-center gap-1", className)}>{dots}</span>;
	return (
		<span role="status" aria-label={label} className={cn("flex items-center gap-1", className)}>
			{dots}
		</span>
	);
}
