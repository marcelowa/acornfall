/**
 * The spacing vocabulary the layout primitives share. Screens choose a name — never a number —
 * and every name is a step on the token grid, so two screens cannot disagree about what "md"
 * means. The failure this prevents is the metricside one: `gap-2` in one file and
 * `gap-[9px]` in the next, both looking deliberate.
 */
export const gapScale = {
	none: "gap-0",
	"2xs": "gap-0.5",
	xs: "gap-1",
	sm: "gap-2",
	md: "gap-3",
	lg: "gap-4",
	xl: "gap-6",
	"2xl": "gap-8",
} as const;

export const paddingScale = {
	none: "",
	sm: "p-2",
	md: "p-4",
	lg: "p-6",
	xl: "p-8",
} as const;

export type GapName = keyof typeof gapScale;
export type PaddingName = keyof typeof paddingScale;
