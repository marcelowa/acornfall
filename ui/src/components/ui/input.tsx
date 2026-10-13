import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "cn";

/**
 * The input, with metricside's size axis kept and the invalid state driven by `aria-invalid`
 * rather than a variant: the attribute is what a screen reader hears, so it is what styles.
 * Sizes name the token step, not a pixel height.
 */
const inputVariants = cva(
	/* `max-sm:text-lg` is the phone rule from step 05: a field prints at 16px there, so iOS does
	 * not zoom the page when it takes focus. `max-sm:h-11` is the rest of the same rule: a field is
	 * a control a thumb hits, and the ladder below `sm` is 44px for every one of them — the search
	 * field in settings was the last one under it (panel finding). */
	"flex h-9 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none selection:bg-primary selection:text-primary-foreground file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground placeholder:text-muted-foreground disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 max-sm:h-11 max-sm:text-lg md:text-sm dark:bg-input/30 focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/50 aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
	{
		variants: {
			inputSize: {
				sm: "h-8 px-2.5 text-sm",
				default: "",
				lg: "h-10 px-3.5 text-base",
			},
		},
		defaultVariants: {
			inputSize: "default",
		},
	},
);

function Input({
	className,
	type,
	inputSize,
	...props
}: React.ComponentProps<"input"> & VariantProps<typeof inputVariants>) {
	return (
		<input
			type={type}
			data-slot="input"
			className={cn(inputVariants({ inputSize }), className)}
			{...props}
		/>
	);
}

export { Input, inputVariants };
