import { useState, type ReactNode } from "react";
import { PanelLeft } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { gapScale } from "./spacing";

/**
 * The workbench: a rail, the pane beside it, and an optional end pane for the inspector where
 * the screen has room (2xl).
 *
 * The rail is part of the grid from `lg` up and behind a toggle below it. A 280px rail on a
 * 390px phone leaves the transcript unusable — which is the actual bug this shape prevents —
 * and Split owns the aside, so it owns the way to open it. The app can control the drawer
 * when a selection should close it; uncontrolled, it works in a story with no wiring.
 *
 * The end pane keeps its grid track at every width (`auto`, then the token at 2xl) so its
 * presence never wraps the middle pane onto a second row.
 */
const splitVariants = cva("grid min-h-0 w-full flex-1 grid-cols-1", {
	variants: {
		gap: gapScale,
		withEnd: {
			true: "lg:grid-cols-[var(--rail-width)_minmax(0,1fr)_auto] 2xl:grid-cols-[var(--rail-width)_minmax(0,1fr)_var(--inspector-width)]",
			false: "lg:grid-cols-[var(--rail-width)_minmax(0,1fr)]",
		},
	},
	defaultVariants: { gap: "none", withEnd: false },
});

export interface SplitProps extends VariantProps<typeof splitVariants> {
	aside: ReactNode;
	/** The inspector, when the screen is wide enough for one. */
	end?: ReactNode | undefined;
	/** Sits in the small-screen bar beside the rail toggle. The conversation title, usually. */
	bar?: ReactNode | undefined;
	asideLabel?: string | undefined;
	asideOpen?: boolean | undefined;
	onAsideOpenChange?: ((open: boolean) => void) | undefined;
	className?: string | undefined;
	children: ReactNode;
}

export function Split({
	aside,
	end,
	bar,
	asideLabel = "Conversations",
	asideOpen,
	onAsideOpenChange,
	gap,
	className,
	children,
}: SplitProps) {
	const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
	const open = asideOpen ?? uncontrolledOpen;
	const setOpen = (next: boolean): void => {
		setUncontrolledOpen(next);
		onAsideOpenChange?.(next);
	};

	return (
		<div className={cn(splitVariants({ gap, withEnd: end !== undefined }), className)}>
			<aside className="hidden min-h-0 min-w-0 flex-col lg:flex">{aside}</aside>
			<div className="flex min-h-0 min-w-0 flex-col">
				<div className="flex items-center gap-1 border-b border-border px-1 py-0.5 lg:hidden">
					<Sheet open={open} onOpenChange={setOpen}>
						<SheetTrigger asChild>
							<Button
								type="button"
								variant="ghost"
								size="icon-sm"
								aria-label={asideLabel}
							>
								<PanelLeft />
							</Button>
						</SheetTrigger>
						<SheetContent
							side="left"
							className="p-2"
							style={{ width: "var(--rail-width)" }}
							aria-describedby={undefined}
						>
							<SheetTitle className="sr-only">{asideLabel}</SheetTitle>
							{aside}
						</SheetContent>
					</Sheet>
					{bar === undefined ? null : (
						<div className="flex min-w-0 flex-1 items-center">{bar}</div>
					)}
				</div>
				{children}
			</div>
			{end === undefined ? null : (
				<aside className="hidden min-h-0 min-w-0 flex-col 2xl:flex">{end}</aside>
			)}
		</div>
	);
}
