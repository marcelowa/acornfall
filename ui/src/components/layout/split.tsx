import {
	useState,
	type CSSProperties,
	type PointerEvent as ReactPointerEvent,
	type ReactNode,
} from "react";
import { PanelLeft, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { Button } from "@/components/ui/button";
import { cn } from "cn";
import { Layer } from "./layer";
import { gapScale } from "./spacing";

const MIN_RAIL = 200;
const MAX_RAIL = 480;

/**
 * The workbench: a rail and the pane beside it.
 *
 * Below `lg` the rail is a layer that slides in from the left edge, under the bar — the bar
 * stays mounted and reachable, so its own toggle is the X that closes the layer, and the layer
 * brings no close of its own (step 06's one-close direction). The bar is `--bar-height` tall,
 * read from the same variable the layer starts at, so the two cannot drift apart. Below `lg`
 * the layer is full width and the transcript dims behind it: a 280px rail beside a 390px phone
 * would leave the transcript a sliver.
 *
 * From `lg` the rail is a column the app can put away; the default is open, and Split owns the
 * layer and the resize handle. In topbar mode the bar carries no rail buttons from `lg`: the
 * rail head closes it while the collapsed strip opens it again. The width is the token unless
 * the app hands one in.
 */
const splitVariants = cva("grid min-h-0 w-full flex-1 grid-cols-1", {
	variants: {
		gap: gapScale,
		collapsed: { true: "", false: "" },
		docked: { true: "", false: "" },
	},
	compoundVariants: [
		{
			collapsed: false,
			docked: false,
			className: "lg:grid-cols-[var(--rail-width)_minmax(0,1fr)]",
		},
		{
			collapsed: true,
			docked: false,
			className: "lg:grid-cols-[var(--rail-collapsed-width)_minmax(0,1fr)]",
		},
		{
			collapsed: false,
			docked: true,
			className:
				"lg:grid-cols-[var(--rail-width)_minmax(0,1fr)] 2xl:grid-cols-[var(--rail-width)_minmax(0,1fr)_var(--inspector-width)]",
		},
		{
			collapsed: true,
			docked: true,
			className:
				"lg:grid-cols-[var(--rail-collapsed-width)_minmax(0,1fr)] 2xl:grid-cols-[var(--rail-collapsed-width)_minmax(0,1fr)_var(--inspector-width)]",
		},
	],
	defaultVariants: { gap: "none", collapsed: false, docked: false },
});

export interface SplitProps extends VariantProps<typeof splitVariants> {
	aside: ReactNode;
	/** Full-width row above everything: the brand, the title, the pane controls. It stays
	 * put on mobile and desktop, layer open or not. Below `lg` the layer toggle sits
	 * beside the brand; from `lg` there are no rail buttons. When set, `bar` and
	 * `header` are ignored so the title lives in one place. */
	topbar?: ReactNode | undefined;
	/** Sits in the small-screen bar beside the rail toggle. The conversation title, usually.
	 * Kept for stories; the app uses `topbar` now. */
	bar?: ReactNode | undefined;
	/** The desktop row above the transcript: the title again, beside pane controls.
	 * Kept for stories; the app uses `topbar` now. */
	header?: ReactNode | undefined;
	/** A third column where the screen has room (2xl): the docked inspector, usually. */
	inspector?: ReactNode | undefined;
	asideLabel?: string | undefined;
	/** The layer, below `lg`. */
	asideOpen?: boolean | undefined;
	onAsideOpenChange?: ((open: boolean) => void) | undefined;
	/**
	 * The app carries the collapse toggle itself — in the rail head, beside the workspace
	 * title — instead of Split floating one over the rail. The collapsed strip keeps its
	 * own way back either way.
	 */
	inlineAsideToggle?: boolean | undefined;
	/** The column, from `lg` up. False keeps it open, which is the default. */
	asideCollapsed?: boolean | undefined;
	onAsideCollapsedChange?:
		| ((collapsed: boolean) => void)
		| undefined /** Controlled rail width in pixels; the token's 280px when omitted. */;
	asideWidth?: number | undefined;
	onAsideWidthChange?: ((width: number) => void) | undefined;
	className?: string | undefined;
	children: ReactNode;
}

export function Split({
	aside,
	topbar,
	bar,
	header,
	inspector,
	asideLabel = "Conversations",
	asideOpen,
	onAsideOpenChange,
	inlineAsideToggle = false,
	asideCollapsed = false,
	onAsideCollapsedChange,
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

	const toggle =
		onAsideCollapsedChange === undefined ? null : (
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				aria-label={asideCollapsed ? "Show the rail" : "Hide the rail"}
				onClick={() => onAsideCollapsedChange(!asideCollapsed)}
			>
				{asideCollapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
			</Button>
		);

	/** The one control that opens a layer and the one that closes it: a hamburger that becomes
	 * an X while the layer is open, in the bar's own corner. */
	const layerToggle = (
		<Button
			type="button"
			variant="ghost"
			size="icon-sm"
			aria-label={open ? "Close navigation" : asideLabel}
			aria-expanded={open}
			onClick={() => setOpen(!open)}
		>
			{open ? <X /> : <PanelLeft />}
		</Button>
	);

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
		<div className={cn("flex min-h-0 w-full flex-1 flex-col", className)} style={width}>
			{topbar === undefined ? null : (
				<div
					data-slot="topbar"
					className="flex h-[var(--bar-height)] shrink-0 items-center gap-1 border-b border-border px-1"
				>
					{/* Below `lg` the layer drops from under this bar: the bar stays mounted, and
					 * its toggle is the only close. From `lg` the bar carries no rail buttons. */}
					<div className="flex shrink-0 items-center lg:hidden">{layerToggle}</div>
					<div className="flex min-w-0 flex-1 items-center gap-2">{topbar}</div>
				</div>
			)}
			{/* The layer is the same shape from both bars and both widths: one left slide, one
			 * close, and it starts where the bar ends. */}
			<Layer
				open={open}
				onOpenChange={setOpen}
				label={asideLabel}
				belowBar
				className="w-full"
			>
				{aside}
			</Layer>
			<div
				className={cn(
					splitVariants({
						gap,
						collapsed: asideCollapsed,
						docked: inspector !== undefined,
					}),
				)}
			>
				<aside className="relative hidden min-h-0 min-w-0 flex-col lg:flex">
					{asideCollapsed ? (
						// Collapsed, the rail is the toggle and nothing else: a strip that keeps the
						// way back where the rail was, instead of a button floating over the transcript.
						<div className="flex min-h-0 flex-1 flex-col items-center overflow-hidden border-r border-border bg-rail py-1">
							{toggle}
						</div>
					) : (
						<>
							{/* The pane clips; its content owns its scroll. The handle stays outside the clip
							 * so a drag does not lose the half that sits on the border. */}
							<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
								{aside}
							</div>
							{inlineAsideToggle ? null : (
								<div className="absolute top-1 right-1 z-10">{toggle}</div>
							)}
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
										if (event.key !== "ArrowLeft" && event.key !== "ArrowRight")
											return;
										event.preventDefault();
										resizeTo(
											(asideWidth ?? 280) +
												(event.key === "ArrowLeft" ? -16 : 16),
										);
									}}
									className={cn(
										"absolute inset-y-0 -right-1 z-10 w-2 cursor-col-resize touch-none bg-transparent",
										"hover:bg-ring/40 focus-visible:bg-ring/40 focus-visible:outline-none",
										dragging && "bg-ring/40",
									)}
								/>
							)}
						</>
					)}
				</aside>
				<div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
					{topbar !== undefined ? null : (
						<>
							<div className="flex items-center gap-1 border-b border-border px-1 py-0.5 lg:hidden">
								{layerToggle}
								{bar === undefined ? null : (
									<div className="flex min-w-0 flex-1 items-center">{bar}</div>
								)}
							</div>
							{header === undefined ? null : (
								<div className="hidden shrink-0 items-center gap-2 border-b border-border px-3 py-1.5 lg:flex">
									{header}
								</div>
							)}
						</>
					)}
					{children}
				</div>
				{inspector === undefined ? null : (
					<div className="hidden min-h-0 min-w-0 flex-col 2xl:flex">{inspector}</div>
				)}
			</div>
		</div>
	);
}
