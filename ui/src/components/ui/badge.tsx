import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";
import { Slot } from "radix-ui";

/**
 * The badge, shaped by metricside's: three weights (soft, solid, outline) over the semantic
 * tones, so a status reads the same everywhere and no call site picks a colour. `soft` is the
 * default because a list of badges should not be a wall of fill.
 *
 * The tones are semantic names, not palette steps: `success` resolves through the semantic
 * layer, and the subtle foreground is the step chosen for 12px text on a 12% tint.
 */
const badgeVariants = cva(
	"inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden rounded-full border border-transparent px-2 py-0.5 text-xs font-medium whitespace-nowrap transition-[color,box-shadow] focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 [&>svg]:pointer-events-none [&>svg]:size-3",
	{
		variants: {
			variant: {
				soft: "",
				solid: "",
				outline: "bg-transparent",
			},
			tone: {
				neutral: "",
				primary: "",
				success: "",
				warning: "",
				info: "",
				danger: "",
			},
			size: {
				sm: "h-5 px-2 text-2xs",
				default: "h-6 text-xs",
				lg: "h-7 px-3 text-sm",
			},
		},
		compoundVariants: [
			{ variant: "soft", tone: "neutral", className: "bg-muted text-muted-foreground" },
			{ variant: "soft", tone: "primary", className: "bg-primary/10 text-primary" },
			{
				variant: "soft",
				tone: "success",
				className: "bg-success-subtle text-success-subtle-foreground",
			},
			{
				variant: "soft",
				tone: "warning",
				className: "bg-warning-subtle text-warning-subtle-foreground",
			},
			{
				variant: "soft",
				tone: "info",
				className: "bg-info-subtle text-info-subtle-foreground",
			},
			{
				variant: "soft",
				tone: "danger",
				className: "bg-destructive-subtle text-destructive-subtle-foreground",
			},
			{
				variant: "solid",
				tone: "neutral",
				className: "bg-secondary text-secondary-foreground",
			},
			{ variant: "solid", tone: "primary", className: "bg-primary text-primary-foreground" },
			{ variant: "solid", tone: "success", className: "bg-success text-success-foreground" },
			{ variant: "solid", tone: "warning", className: "bg-warning text-warning-foreground" },
			{ variant: "solid", tone: "info", className: "bg-info text-info-foreground" },
			{
				variant: "solid",
				tone: "danger",
				className: "bg-destructive text-destructive-foreground",
			},
			{
				variant: "outline",
				tone: "neutral",
				className: "border-border text-muted-foreground",
			},
			{ variant: "outline", tone: "primary", className: "border-primary/40 text-primary" },
			{
				variant: "outline",
				tone: "success",
				className: "border-success/40 text-success-subtle-foreground",
			},
			{
				variant: "outline",
				tone: "warning",
				className: "border-warning/40 text-warning-subtle-foreground",
			},
			{
				variant: "outline",
				tone: "info",
				className: "border-info/40 text-info-subtle-foreground",
			},
			{
				variant: "outline",
				tone: "danger",
				className: "border-destructive/40 text-destructive-subtle-foreground",
			},
		],
		defaultVariants: {
			variant: "soft",
			tone: "neutral",
			size: "default",
		},
	},
);

function Badge({
	className,
	variant = "soft",
	tone = "neutral",
	size = "default",
	asChild = false,
	...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
	const Comp = asChild ? Slot.Root : "span";

	return (
		<Comp
			data-slot="badge"
			data-variant={variant}
			data-tone={tone}
			className={cn(badgeVariants({ variant, tone, size }), className)}
			{...props}
		/>
	);
}

export { Badge, badgeVariants };
