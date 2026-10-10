import {
	useState,
	type CSSProperties,
	type PointerEvent as ReactPointerEvent,
	type ReactNode,
} from "react";
import { PanelLeft, PanelLeftClose, PanelLeftOpen, X } from "lucide-react";
import { cva, type VariantProps } from "class-variance-authority";
import { Dialog as SheetPrimitive } from "radix-ui";
import { Button } from "@/components/ui/button";
import { Sheet, SheetClose, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "cn";
import { gapScale } from "./spacing";

const MIN_RAIL = 200;
const MAX_RAIL = 480;

/**
 * The workbench: a rail and the pane beside it.
 *
 * Below `lg` the rail is a drawer that drops from under the top bar — the bar stays
 * mounted, so the brand and the title never leave. The bar is a fixed `h-12`, and the
 * drawer starts exactly there: full width, dimmed transcript behind it. A 280px rail
 * beside a 390px phone would leave the transcript a sliver, and a drawer that only
 * half-opens is a worse version of the same mistake. From `lg` the rail is a column
 * the app can put away; the default is open, and Split owns the drawer and the resize
 * handle. In topbar mode the bar carries no rail buttons from `lg`: the rail head
 * closes it while the collapsed strip opens it again. Below `lg` the drawer toggle
 * sits beside the brand and swaps hamburger for X, because tapping the brand alone
 * opens nothing. The width
 * is the token unless the app hands one in.
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
	 * put on mobile and desktop, rail open or not. Below `lg` the drawer toggle sits
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
	/** The drawer, below `lg`. */
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

	/** The drawer body, shared with the small-screen bar below: the toggle opens it,
	 * the drawer's own close row shuts it. */
	const drawerContent = (
		<SheetContent
			side="left"
			showCloseButton={false}
			className="w-full p-2 sm:max-w-none"
			aria-describedby={undefined}
		>
			<SheetTitle className="sr-only">{asideLabel}</SheetTitle>
			<div className="flex min-h-0 flex-1 flex-col">
				{/* The close gets its own row: absolutely positioned over the rail
				 * it would land on the head's own icon buttons, which is exactly
				 * the overlap the floating toggle used to be. */}
				<div className="flex shrink-0 items-center justify-end">
					<SheetClose asChild>
						<Button
							type="button"
							variant="ghost"
							size="icon-sm"
							aria-label="Hide the rail"
						>
							<PanelLeftClose />
						</Button>
					</SheetClose>
				</div>
				{aside}
			</div>
		</SheetContent>
	);

	const drawer = (
		<Sheet open={open} onOpenChange={setOpen}>
			<SheetTrigger asChild>
				<Button type="button" variant="ghost" size="icon-sm" aria-label={asideLabel}>
					<PanelLeft />
				</Button>
			</SheetTrigger>
			{/* Full width: the drawer is the navigation, and half a screen of it is
			 * neither the rail nor the transcript. Its close is the rail's own icon in the
			 * rail's own corner, so the gesture is the same on both screens. */}
			{drawerContent}
		</Sheet>
	);

	return (
		<div className={cn("flex min-h-0 w-full flex-1 flex-col", className)} style={width}>
			{topbar === undefined ? null : (
				<div
					data-slot="topbar"
					className="flex h-12 shrink-0 items-center gap-1 border-b border-border px-1"
				>
					{/* Below `lg` the drawer drops from under this bar: the bar stays
					 * mounted, the toggle swaps hamburger for X, and the transcript dims
					 * behind the drawer. From `lg` the bar carries no rail buttons. */}
					<div className="flex shrink-0 items-center lg:hidden">
						<Sheet open={open} onOpenChange={setOpen}>
							<SheetTrigger asChild>
								<Button
									type="button"
									variant="ghost"
									size="icon-sm"
									aria-label={open ? "Close navigation" : asideLabel}
									aria-expanded={open}
								>
									{open ? <X /> : <PanelLeft />}
								</Button>
							</SheetTrigger>
							<SheetPrimitive.Portal>
								<SheetPrimitive.Overlay
									data-slot="sheet-overlay"
									className="fixed top-12 right-0 bottom-0 left-0 z-50 bg-overlay data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0"
								/>
								<SheetPrimitive.Content
									data-slot="sheet-content"
									aria-describedby={undefined}
									className="fixed top-12 right-0 bottom-0 left-0 z-50 flex flex-col bg-rail transition ease-in-out data-[state=closed]:animate-out data-[state=closed]:slide-out-to-top data-[state=closed]:duration-300 data-[state=open]:animate-in data-[state=open]:slide-in-from-top data-[state=open]:duration-300"
								>
									<SheetTitle className="sr-only">{asideLabel}</SheetTitle>
									<div className="flex min-h-0 flex-1 flex-col overflow-hidden">
										{aside}
									</div>
								</SheetPrimitive.Content>
							</SheetPrimitive.Portal>
						</Sheet>
					</div>
					<div className="flex min-w-0 flex-1 items-center gap-2">{topbar}</div>
				</div>
			)}
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
								{drawer}
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
