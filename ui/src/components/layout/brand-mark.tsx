/**
 * The brand mark, light and dark: the new logo's dark ink hides on a dark
 * background, so the dark file lightens exactly that part. One file per
 * theme, swapped by the theme class — never filters, which would tint
 * the blue too.
 */
export function BrandMark() {
	return (
		<>
			<img src="/logo.svg" alt="" aria-hidden className="h-6 w-auto shrink-0 dark:hidden" />
			<img
				src="/logo-dark.svg"
				alt=""
				aria-hidden
				className="hidden h-6 w-auto shrink-0 dark:block"
			/>
		</>
	);
}
