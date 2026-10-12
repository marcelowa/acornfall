import type { ReactNode } from "react";
import { Dialog as LayerPrimitive } from "radix-ui";
import { cn } from "cn";

/**
 * The one way a layer arrives: full width, slid in from the left edge, out to the left, and
 * without a close of its own.
 *
 * It replaces the two implementations this pass found — the phone drawer that dropped from the
 * top bar (`split.tsx`) and the shadcn sheet (`ui/sheet.tsx`) — because two left layers with
 * two closes in two corners is two shapes to learn. The close lives in the bar: the bar's own
 * toggle is the X, which is why the layer starts below the bar (`belowBar`) and why the layer
 * is not modal. A modal layer blocks the bar it is supposed to be closed from, and an
 * outside-interaction close would race that same button: tapping the X would close and reopen
 * in one gesture.
 *
 * The rail and the workspaces list both arrive through this, so the gesture, the direction and
 * the duration are the same for both.
 */
export interface LayerProps {
	open: boolean;
	onOpenChange: (open: boolean) => void;
	/** What the layer is, for a screen reader: it has no visible title of its own. */
	label: string;
	/** Starts below the bar, so the bar's toggle stays reachable while it is open. */
	belowBar?: boolean | undefined;
	className?: string | undefined;
	children: ReactNode;
}

export function Layer({
	open,
	onOpenChange,
	label,
	belowBar = false,
	className,
	children,
}: LayerProps) {
	return (
		<LayerPrimitive.Root open={open} onOpenChange={onOpenChange} modal={false}>
			<LayerPrimitive.Portal>
				<LayerPrimitive.Overlay
					data-slot="layer-overlay"
					className={cn(
						"fixed inset-x-0 bottom-0 z-50 bg-overlay data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0",
						belowBar ? "top-[var(--bar-height)]" : "top-0",
					)}
				/>
				<LayerPrimitive.Content
					data-slot="layer"
					aria-describedby={undefined}
					/* The bar's toggle and Back are the ways out; a click on the dimmed pane is
					 * not, so an accidental tap cannot close a layer mid-read. */
					onInteractOutside={(event) => event.preventDefault()}
					className={cn(
						"fixed inset-x-0 z-50 flex flex-col overflow-hidden bg-rail transition ease-in-out data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=closed]:duration-200 data-[state=open]:animate-in data-[state=open]:slide-in-from-left data-[state=open]:duration-200",
						belowBar ? "top-[var(--bar-height)] bottom-0" : "inset-y-0",
						className,
					)}
				>
					<LayerPrimitive.Title className="sr-only">{label}</LayerPrimitive.Title>
					{children}
				</LayerPrimitive.Content>
			</LayerPrimitive.Portal>
		</LayerPrimitive.Root>
	);
}
