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
 * Below `lg` the rail is a drawer that takes the screen it is on — a 280px rail beside a
 * 390px phone leaves the transcript unusable, and a drawer that only half-opens is a worse
 * version of the same mistake. From `lg` it is a column the app can put away; the default is
 * open, and Split owns the aside, so it owns the way to open, close, and resize it. The width
 * is the token unless the app hands one in.
 */
const splitVariants = cva("grid min-h-0 w-full flex-1 grid-cols-1", {
	variants: {
		gap: gapScale,
		withEnd: { true: "", false: "" },
		collapsed: { true: "", false: "" },
	},
	compoundVariants: [
		{
			withEnd: false,
			collapsed: false,
			className: "lg:grid-cols-[var(--rail-width)_minmax(0,1fr)]",
		},
		{ withEnd: false, collapsed: true, className: "lg:grid-cols-[minmax(0,1fr)]" },
		{
			withEnd: true,
			collapsed: false,
			className:
				"lg:grid-cols-[var(--rail-width)_minmax(0,1fr)_auto] 2xl:grid-cols-[var(--rail-width)_minmax(0,1fr)_var(--inspector-width)]",
		},
		{
			withEnd: true,
			collapsed: true,
			className:
				"lg:grid-cols-[minmax(0,1fr)_auto] 2xl:grid-cols-[minmax(0,1fr)_var(--inspector-width)]",
		},
	],
	defaultVariants: { gap: "none", withEnd: false, collapsed: false },
});

export interface SplitProps extends VariantProps<typeof splitVariants> {
	aside: ReactNode;
	/** The inspector, when the screen is wide enough for one. */
	end?: ReactNode | undefined;
	/** Sits in the small-screen bar beside the rail toggle. The conversation title, usually. */
	bar?: ReactNode | undefined;
	asideLabel?: string | undefined;
	/** The drawer, below `lg`. */
	asideOpen?: boolean | undefined;
	onAsideOpenChange?: ((open: boolean) => void) | undefined;
	/** The column, from `lg` up. False keeps it open, which is the default. */
	asideCollapsed?: boolean | undefined;
	onAsideCollapsedChange?: ((collapsed: boolean) => void) | undefined;
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
	asideCollapsed = false,
	onAsideCollapsedChange: _onAsideCollapsedChange,
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
			className={cn(
				splitVariants({ gap, withEnd: end !== undefined, collapsed: asideCollapsed }),
				className,
			)}
			style={width}
		>
			<aside
				className={cn(
					"relative hidden min-h-0 min-w-0 flex-col lg:flex",
					asideCollapsed && "lg:hidden",
				)}
			>
				{/* The pane clips; its content owns its scroll. The handle stays outside the clip so
				 * a drag does not lose the half that sits on the border. */}
				<div className="flex min-h-0 flex-1 flex-col overflow-hidden">{aside}</div>
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
			<div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
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
						{/* Full width: the drawer is the navigation, and half a screen of it is
						 * neither the rail nor the transcript. */}
						<SheetContent
							side="left"
							className="w-full p-2 sm:max-w-none"
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
				<aside className="hidden min-h-0 min-w-0 flex-col overflow-hidden 2xl:flex">
					{end}
				</aside>
			)}
		</div>
	);
}
