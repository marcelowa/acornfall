import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/**
 * The one way a component merges a caller's class names with its own. Components own their
 * styling, and a caller that passes classes is changing a component's appearance — the
 * exception, not the rule, which is why `tailwind-merge` resolves the conflict in the
 * caller's favour.
 */
export function cn(...inputs: ClassValue[]): string {
	return twMerge(clsx(inputs));
}
