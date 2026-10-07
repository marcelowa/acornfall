import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface ThemeToggleProps {
	theme: "light" | "dark";
	onToggle: () => void;
	className?: string;
}

/**
 * Dumb on purpose: it is told which theme is on and it reports the click. Where the theme
 * lives — localStorage, the OS preference, the server — is the app's decision, and the story
 * renders both states without a browser.
 */
export function ThemeToggle({ theme, onToggle, className }: ThemeToggleProps) {
	const next = theme === "dark" ? "light" : "dark";

	return (
		<Button
			type="button"
			variant="ghost"
			size="icon-sm"
			onClick={onToggle}
			className={className}
			title={`Switch to the ${next} theme`}
			aria-label={`Switch to the ${next} theme`}
		>
			{theme === "dark" ? <Sun /> : <Moon />}
		</Button>
	);
}
