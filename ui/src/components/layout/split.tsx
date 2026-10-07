import {
	useState,
	type CSSProperties,
	type PointerEvent as ReactPointerEvent,
	type ReactNode,
} from "react";
import { PanelLeft } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "cn";
import { gapScale } from "./spacing";

const MIN_RAIL = 200;
const MAX_RAIL = 480;

/**
 * The workbench: a rail, the pane beside it, and an optional end pane for the inspector where
 * the screen has room (2xl).
 *
 * The rail is part of the grid from `lg` up and behind a toggle below it. A 280px rail on a
 * 390px phone leaves the transcript unusable — which is the actual bug this shape prevents —
 * and Split owns the aside, so it owns the way to open it, and the handle that resizes it.
 * The width is controlled by the app when it wants the choice to survive a reload; the
 * default is the token.
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
	/** Controlled rail width in pixels; the token's 280px when omitted. */
	asideWidth?: number | undefined;
	onAsideWidthChange?: ((width: number) => void) | undefined;
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
	asideWidth,
	onAsideWidthChange,
	gap,
	className,
	children,
}: SplitProps) {
	const [uncontrolledOpen, setUncontrolledOpen] = useState(false);
	const [dragging, setDragging] = useState(false);
	const open = asideOpen ?? uncontrolledOpen;
	const setOpen = (next: boolean): void => {
		setUncontrolledOpen(next);
		onAsideOpenChange?.(next);
	};

	/** Overriding one token on the grid is what makes the template — and every breakpoint in
	 * it — follow the drag, without a second template to keep in sync. */
	const width =
		asideWidth === undefined
			? undefined
			: ({ "--rail-width": `${asideWidth}px` } as CSSProperties);

	const resizeTo = (next: number): void => {
		onAsideWidthChange?.(Math.min(MAX_RAIL, Math.max(MIN_RAIL, next)));
	};

	const startDrag = (event: ReactPointerEvent<HTMLDivElement>): void => {
		if (onAsideWidthChange === undefined) return;
		event.preventDefault();
		const startX = event.clientX;
		const startWidth = asideWidth ?? 280;
		const handle = event.currentTarget;
		handle.setPointerCapture(event.pointerId);
		setDragging(true);

		const move = (moveEvent: PointerEvent): void =>
			resizeTo(startWidth + (moveEvent.clientX - startX));
		const stop = (): void => {
			setDragging(false);
			handle.removeEventListener("pointermove", move);
			handle.removeEventListener("pointerup", stop);
			handle.removeEventListener("pointercancel", stop);
		};
		handle.addEventListener("pointermove", move);
		handle.addEventListener("pointerup", stop);
		handle.addEventListener("pointercancel", stop);
	};

	return (
		<div
			className={cn(splitVariants({ gap, withEnd: end !== undefined }), className)}
			style={width}
		>
			<aside className="relative hidden min-h-0 min-w-0 flex-col lg:flex">
				{aside}
				{onAsideWidthChange === undefined ? null : (
					<div
						role="separator"
						data-slot="splitter"
						aria-orientation="vertical"
						aria-label="Resize the rail"
						aria-valuenow={asideWidth ?? 280}
						aria-valuemin={MIN_RAIL}
						aria-valuemax={MAX_RAIL}
						tabIndex={0}
						onPointerDown={startDrag}
						onKeyDown={(event) => {
							if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
							event.preventDefault();
							resizeTo((asideWidth ?? 280) + (event.key === "ArrowLeft" ? -16 : 16));
						}}
						className={cn(
							"absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none bg-transparent",
							"hover:bg-ring/40 focus-visible:bg-ring/40 focus-visible:outline-none",
							dragging && "bg-ring/40",
						)}
					/>
				)}
			</aside>
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
