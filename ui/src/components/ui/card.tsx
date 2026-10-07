import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";

/**
 * Cards, with metricside's three weights: outlined (the default surface), elevated (raised
 * off the page), and interactive (raised on hover, for a card that is a link). The radius and
 * padding are the subcomponents' — the variant decides depth only.
 */
const cardVariants = cva(
	"flex flex-col gap-6 rounded-xl border bg-card py-6 text-card-foreground",
	{
		variants: {
			variant: {
				outlined: "border-border shadow-sm",
				elevated: "border-transparent shadow-lg",
				interactive:
					"cursor-pointer border-transparent shadow-md transition-shadow hover:shadow-lg focus-visible:ring-2 focus-visible:ring-ring/50",
			},
		},
		defaultVariants: {
			variant: "outlined",
		},
	},
);

function Card({
	className,
	variant = "outlined",
	...props
}: React.ComponentProps<"div"> & VariantProps<typeof cardVariants>) {
	return (
		<div
			data-slot="card"
			data-variant={variant}
			className={cn(cardVariants({ variant }), className)}
			{...props}
		/>
	);
}

function CardHeader({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-header"
			className={cn(
				"@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-2 px-6 has-data-[slot=card-action]:grid-cols-[1fr_auto] [.border-b]:pb-6",
				className,
			)}
			{...props}
		/>
	);
}

function CardTitle({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-title"
			className={cn("leading-none font-semibold", className)}
			{...props}
		/>
	);
}

function CardDescription({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-description"
			className={cn("text-sm text-muted-foreground", className)}
			{...props}
		/>
	);
}

function CardAction({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-action"
			className={cn(
				"col-start-2 row-span-2 row-start-1 self-start justify-self-end",
				className,
			)}
			{...props}
		/>
	);
}

function CardContent({ className, ...props }: React.ComponentProps<"div">) {
	return <div data-slot="card-content" className={cn("px-6", className)} {...props} />;
}

function CardFooter({ className, ...props }: React.ComponentProps<"div">) {
	return (
		<div
			data-slot="card-footer"
			className={cn("flex items-center px-6 [.border-t]:pt-6", className)}
			{...props}
		/>
	);
}

export {
	Card,
	CardHeader,
	CardFooter,
	CardTitle,
	CardAction,
	CardDescription,
	CardContent,
	cardVariants,
};
