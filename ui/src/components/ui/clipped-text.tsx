import { useEffect, useRef, useState } from "react";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "cn";

export interface ClippedTextProps {
	text: string;
	/** Classes for the text itself: the clipping class belongs to the caller. */
	className?: string | undefined;
	/** The tooltip's side, for a label at the edge of a pane. */
	side?: "top" | "bottom" | undefined;
}

/**
 * Text that may not fit, with the whole of it one gesture away. A truncated name is fine — the
 * rail, a card header and a workspace row all have to stay one line — but a name nobody can read
 * anywhere is a name that was lost, so hovering it, focusing it or tapping it shows the rest.
 *
 * Whether the text is clipped is measured on the gesture, not on mount: a label measured while the
 * story, the pane or the font is still settling reports that it fits, and then never reports again,
 * because the box never changes size. At the moment someone asks, the layout is final.
 *
 * The trigger is focusable, which is what makes the tooltip reachable from a keyboard, and a tap
 * opens it because a pointer without hover has no other way to ask.
 */
export function ClippedText({ text, className, side = "top" }: ClippedTextProps) {
	const ref = useRef<HTMLSpanElement>(null);
	const [open, setOpen] = useState(false);
	/** A tap leaves no pointer to leave with, so the tooltip closes itself. */
	const timer = useRef<number | undefined>(undefined);
	useEffect(() => () => window.clearTimeout(timer.current), []);

	/** True when the label is showing less than all of its text, asked at the moment of the gesture. */
	const isClipped = (): boolean => {
		const element = ref.current;
		if (element === null) return false;
		return element.clientWidth > 0 && element.scrollWidth > element.clientWidth + 1;
	};

	return (
		<Tooltip open={open} onOpenChange={setOpen}>
			<TooltipTrigger asChild>
				<span
					tabIndex={0}
					onPointerEnter={() => setOpen(isClipped())}
					onPointerLeave={() => setOpen(false)}
					onFocus={() => setOpen(isClipped())}
					onBlur={() => setOpen(false)}
					// A finger does not hover: a tap asks the same question, and the tooltip closes on
					// its own when the pointer leaves or the trigger blurs.
					onPointerUp={(event) => {
						if (event.pointerType !== "touch") return;
						setOpen(isClipped());
						window.clearTimeout(timer.current);
						timer.current = window.setTimeout(() => setOpen(false), 3000);
					}}
					className="min-w-0 rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
				>
					<span ref={ref} className={cn("block truncate", className)}>
						{text}
					</span>
				</span>
			</TooltipTrigger>
			<TooltipContent side={side}>
				<span className="font-mono break-all">{text}</span>
			</TooltipContent>
		</Tooltip>
	);
}
