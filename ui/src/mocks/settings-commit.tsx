import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Text } from "@/components/typography/text";
import { cn } from "cn";

export interface MockImageFieldProps {
	/** What the field says after the commit landed, or that it did not. */
	state: "idle" | "applied" | "refused";
	/** Where the page commits: the field's own button, or nothing visible at all. */
	moment: "field" | "blur";
}

/**
 * The sandbox image field with one commit moment. The findings (J5, OWNER-OPERATOR and
 * TINKERER): a typed value and a saved one look the same, a refusal shows only in the strip at
 * the top of the pane while the typed text stays, and the caption has to explain the blur
 * exception. This mock puts the outcome where the field sits.
 */
export function MockImageField({ state, moment }: MockImageFieldProps) {
	return (
		<div className="flex flex-col gap-1.5">
			<Text as="p" size="sm" weight="medium">
				Sandbox image
			</Text>
			<div className="flex items-center gap-2">
				<Input
					readOnly
					defaultValue="acornfall/sandbox:0.7.6"
					className={cn(state === "refused" && "border-destructive")}
				/>
				{moment === "field" ? (
					<Button type="button" size="sm">
						Apply
					</Button>
				) : null}
			</div>
			{state === "applied" ? (
				<Text as="p" size="2xs" className="text-success-subtle-foreground">
					Applied — the next sandbox in this workspace uses it
				</Text>
			) : null}
			{state === "refused" ? (
				<Text as="p" size="2xs" className="text-destructive">
					Refused: no image by that name. The field still holds what you typed.
				</Text>
			) : null}
			{moment === "blur" ? (
				<Text as="p" size="2xs" tone="muted">
					Applies as chosen — the image when you leave the field
				</Text>
			) : null}
		</div>
	);
}
