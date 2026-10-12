import type { CSSProperties } from "react";
import { Stack } from "@/components/layout/stack";
import { Text } from "@/components/typography/text";

/**
 * The phone type ladder, before and after, inside one story. The variables are the same ones
 * `globals.css` redefines below 640px, set here so both ladders can stand side by side at any
 * viewport width.
 *
 * Today the phone bump moves 2xs/xs/sm up one step and leaves `base` at 14px, so `sm` and
 * `base` are both 14px and chrome reads as content. The proposal moves every step up to `lg`,
 * which leaves one clear step between chrome and content and keeps the transcript body at 16px.
 */
const today = {
	"--text-2xs": "12px",
	"--text-xs": "13px",
	"--text-sm": "14px",
	"--text-base": "14px",
} as CSSProperties;

const proposed = {
	"--text-2xs": "12px",
	"--text-xs": "13px",
	"--text-sm": "14px",
	"--text-base": "15px",
} as CSSProperties;

function Specimen() {
	return (
		<Stack gap="sm">
			<Text as="p" size="2xs" tone="muted" className="font-mono tabular-nums">
				12.4k tok · $0.0432 · 2h
			</Text>
			<Text as="p" size="sm" weight="semibold">
				The stream sends state views
			</Text>
			<Text as="p" size="base">
				The run ended, so the card settles and the output folds away under the answer.
			</Text>
		</Stack>
	);
}

export interface MockTypeColumnProps {
	variant: "today" | "proposed";
}

export function MockTypeColumn({ variant }: MockTypeColumnProps) {
	const label = variant === "today" ? "Today on a phone" : "Proposed on a phone";
	const sizes =
		variant === "today"
			? "meta 12 · row 14 · body 14 — row and body collide"
			: "meta 12 · row 14 · body 15 — one step apart";
	return (
		<Stack gap="sm" style={variant === "today" ? today : proposed}>
			<Stack gap="2xs">
				<Text as="p" size="sm" weight="semibold">
					{label}
				</Text>
				<Text as="p" size="2xs" tone="muted" className="font-mono tabular-nums">
					{sizes}
				</Text>
			</Stack>
			<div className="rounded-lg border border-border bg-card p-3">
				<Specimen />
			</div>
		</Stack>
	);
}
