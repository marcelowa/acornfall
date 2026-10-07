import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/**
 * Copy is the one control a transcript pane always shows.
 *
 * navigator.clipboard exists only in a secure context, and the interface is served over the
 * tailnet's plain HTTP, so the old client's textarea fallback is kept: without it the button
 * would work on localhost and fail on the URL people actually use.
 */
async function writeClipboard(value: string): Promise<void> {
	if (navigator.clipboard?.writeText !== undefined) {
		await navigator.clipboard.writeText(value);
		return;
	}
	const scratch = document.createElement("textarea");
	scratch.value = value;
	scratch.style.position = "fixed";
	scratch.style.opacity = "0";
	document.body.appendChild(scratch);
	scratch.select();
	document.execCommand("copy");
	scratch.remove();
}

export interface CopyButtonProps {
	value: string;
	label?: string | undefined;
	className?: string | undefined;
	onCopied?: (() => void) | undefined;
}

export function CopyButton({ value, label = "Copy", className, onCopied }: CopyButtonProps) {
	const [result, setResult] = useState<"idle" | "copied" | "failed">("idle");
	const timer = useRef<number | null>(null);

	useEffect(
		() => () => {
			if (timer.current !== null) window.clearTimeout(timer.current);
		},
		[],
	);

	async function copy(): Promise<void> {
		try {
			await writeClipboard(value);
			setResult("copied");
			onCopied?.();
		} catch {
			setResult("failed");
		}
		if (timer.current !== null) window.clearTimeout(timer.current);
		timer.current = window.setTimeout(() => setResult("idle"), 1200);
	}

	return (
		<Button
			type="button"
			variant="ghost"
			size="xs"
			className={cn(className)}
			onClick={() => void copy()}
			aria-live="polite"
		>
			{result === "copied" ? "Copied" : result === "failed" ? "Copy failed" : label}
		</Button>
	);
}
