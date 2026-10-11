import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { Stack } from "@/components/layout/stack";
import { Code } from "@/components/typography/code";
import { Heading } from "@/components/typography/heading";
import { Text } from "@/components/typography/text";
import { cn } from "cn";

const meta = {
	title: "Foundations/Colour",
	parameters: {
		layout: "fullscreen",
		docs: {
			description: {
				story: "The semantic layer: every swatch is shown with the foreground it pairs with, and the class name under it is the one that resolves. Switch the theme in the toolbar — the same classes, different values.",
			},
		},
	},
	tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

interface Swatch {
	name: string;
	className: string;
	foreground: string;
}

const surfaces: Swatch[] = [
	{ name: "background", className: "bg-background", foreground: "text-foreground" },
	{ name: "card", className: "bg-card", foreground: "text-card-foreground" },
	{ name: "popover", className: "bg-popover", foreground: "text-popover-foreground" },
	{ name: "muted", className: "bg-muted", foreground: "text-muted-foreground" },
	{ name: "secondary", className: "bg-secondary", foreground: "text-secondary-foreground" },
	{ name: "accent", className: "bg-accent", foreground: "text-accent-foreground" },
];

const solid: Swatch[] = [
	{ name: "primary", className: "bg-primary", foreground: "text-primary-foreground" },
	{ name: "destructive", className: "bg-destructive", foreground: "text-destructive-foreground" },
	{ name: "success", className: "bg-success", foreground: "text-success-foreground" },
	{ name: "warning", className: "bg-warning", foreground: "text-warning-foreground" },
	{ name: "info", className: "bg-info", foreground: "text-info-foreground" },
];

const tints: Swatch[] = [
	{
		name: "success-subtle",
		className: "bg-success-subtle",
		foreground: "text-success-subtle-foreground",
	},
	{
		name: "warning-subtle",
		className: "bg-warning-subtle",
		foreground: "text-warning-subtle-foreground",
	},
	{ name: "info-subtle", className: "bg-info-subtle", foreground: "text-info-subtle-foreground" },
	{
		name: "destructive-subtle",
		className: "bg-destructive-subtle",
		foreground: "text-destructive-subtle-foreground",
	},
];

const lines: Swatch[] = [
	{ name: "border", className: "border-2 border-border", foreground: "" },
	{ name: "input", className: "border-2 border-input", foreground: "" },
	{
		name: "ring",
		className: "ring-2 ring-ring ring-offset-2 ring-offset-background",
		foreground: "",
	},
	{ name: "overlay", className: "bg-overlay", foreground: "text-foreground" },
];

function Tile({ swatch }: { swatch: Swatch }) {
	return (
		<Stack gap="2xs">
			<div
				className={cn(
					"flex h-16 items-center justify-center rounded-md border border-border",
					swatch.className,
				)}
			>
				<span className={cn("text-sm font-medium", swatch.foreground)}>Aa</span>
			</div>
			<Code>{swatch.name}</Code>
		</Stack>
	);
}

function Section({ title, children }: { title: string; children: ReactNode }) {
	return (
		<Stack gap="sm">
			<Heading level={3}>{title}</Heading>
			{children}
		</Stack>
	);
}

function Tiles({ swatches }: { swatches: Swatch[] }) {
	return (
		<div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
			{swatches.map((swatch) => (
				<Tile key={swatch.name} swatch={swatch} />
			))}
		</div>
	);
}

const steps = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950];

/**
 * The raw ramps behind the roles: brand carries primary, secondary carries
 * the quiet support. Inline styles, not classes — no utility resolves to a
 * primitive, and the palette page is the only place that reads them.
 */
function Ramps({ scale }: { scale: "brand" | "secondary" }) {
	return (
		<div className="grid grid-cols-4 gap-2 sm:grid-cols-6 lg:grid-cols-11">
			{steps.map((step) => (
				<Stack key={step} gap="2xs">
					<div
						className="h-16 rounded-md border border-border"
						style={{ background: `var(--base-${scale}-${step})` }}
					/>
					<Code>{`${scale}-${step}`}</Code>
				</Stack>
			))}
		</div>
	);
}

export const Colour: Story = {
	render: () => (
		<div className="mx-auto w-full max-w-4xl p-8">
			<Stack gap="xl">
				<Stack gap="xs">
					<Heading level={1}>Colour</Heading>
					<Text tone="muted">
						Semantic names, not palette steps. The status tints are 12% of their own
						strong colour by construction, so there is no second value to keep in sync.
					</Text>
				</Stack>
				<Section title="Surfaces">
					<Tiles swatches={surfaces} />
				</Section>
				<Section title="Text">
					<div className="flex flex-wrap gap-6">
						{[
							"text-foreground",
							"text-muted-foreground",
							"text-primary",
							"text-destructive",
						].map((className) => (
							<Stack key={className} gap="2xs" align="start">
								<span className={cn("text-base font-medium", className)}>Aa</span>
								<Code>{className}</Code>
							</Stack>
						))}
					</div>
				</Section>
				<Section title="Solid: fills and their foreground">
					<Tiles swatches={solid} />
				</Section>
				<Section title="Tints: status text on a status surface">
					<Tiles swatches={tints} />
				</Section>
				<Section title="Lines and scrim">
					<Tiles swatches={lines} />
				</Section>
				<Section title="Ramps: brand carries primary, secondary carries support">
					<Ramps scale="brand" />
					<Ramps scale="secondary" />
				</Section>
			</Stack>
		</div>
	),
};
