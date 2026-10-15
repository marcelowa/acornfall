import { ArrowUp, RotateCw } from "lucide-react";
import type { UpdateStatus } from "@/app/client";
import { Text } from "@/components/typography/text";
import { Button } from "@/components/ui/button";

export interface ReleaseMarkProps {
	status: UpdateStatus | undefined;
	onOpen: () => void;
}

/**
 * The bar's update mark: one control, two widths (R12, J16, J20).
 *
 * A desktop shows the newest production release's tag beside the arrow; a phone shows the arrow
 * alone, and its accessible name carries the target — a bare mark cannot say a version, but it
 * can say one to a screen reader. Restart pending takes the same spot in the warning tone: it is
 * the one state that needs the owner and cannot wait for a page visit.
 */
export function ReleaseMark({ status, onOpen }: ReleaseMarkProps) {
	if (status === undefined) return null;
	if (status.restartRequired === true) {
		// The word is the sign at arm's length; the icon alone is a `RotateCw` someone reads as
		// "reload". The phone keeps the icon and says the rest to a screen reader.
		return (
			<Button
				type="button"
				variant="ghost"
				size="sm"
				className="text-warning-subtle-foreground max-sm:min-w-11 max-sm:[&_svg]:size-5"
				aria-label="Restart pending: the new build is on disk"
				onClick={onOpen}
			>
				<RotateCw />
				<Text as="span" size="2xs" tone="muted" className="max-sm:hidden">
					Restart
				</Text>
			</Button>
		);
	}
	if (!status.available) return null;
	return (
		<Button
			type="button"
			variant="ghost"
			size="sm"
			aria-label={
				status.latest === "" ? "Update available" : `Update available: ${status.latest}`
			}
			// The legible accent, not `--primary`: primary on the light bar is 1.48:1, under the
			// 3:1 a graphic needs; this step is 3.17:1 light and 9.85:1 dark (measured).
			className="text-primary-subtle-foreground max-sm:min-w-11 max-sm:[&_svg]:size-5"
			onClick={onOpen}
		>
			<ArrowUp />
			<Text as="span" size="2xs" tone="muted" className="font-mono max-sm:hidden">
				{status.latest}
			</Text>
		</Button>
	);
}
