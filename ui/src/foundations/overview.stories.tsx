import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "@/components/layout/stack";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Code } from "@/components/typography/code";
import { Heading } from "@/components/typography/heading";
import { Text } from "@/components/typography/text";

const meta = {
	title: "Foundations/Overview",
	parameters: {
		layout: "fullscreen",
		docs: {
			description: {
				story: [
					"Design values travel one way. **Primitives** are the raw values. The **semantic layer** names what they mean, and it is the only layer the theme swaps. **Tailwind** maps those names to the classes components type. A component that cannot say what it needs in the semantic layer adds a component token: the exception is still a token, and it is still in tokens.css.",
					"Foundations pages are the catalogue's own. They review the vocabulary; they are not a place to import from.",
				].join("\n\n"),
			},
		},
	},
	tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

interface Layer {
	name: string;
	example: string;
	what: string;
}

const layers: Layer[] = [
	{
		name: "Primitives",
		example: "--base-brand-500",
		what: "Ramps, type, spacing on the 4px grid, radius, shadow, and motion. No utility resolves to one; the palette page is the only place that reads them.",
	},
	{
		name: "Semantic",
		example: "--primary",
		what: "What a thing means, not what it is. Light and dark swap this layer and nothing else, so the two themes cannot drift apart.",
	},
	{
		name: "Tailwind",
		example: "bg-primary",
		what: "The classes components use. Every namespace starts from nothing: a class without a token behind it is not a smaller step, it is no CSS at all.",
	},
];

// check-system:ignore -- the page exists to show the names the check rejects
const rejected = ["p-13", "bg-blue-500", "text-lg", "text-[11px]", "bg-[#fff]"];

export const Layers: Story = {
	render: () => (
		<div className="mx-auto w-full max-w-3xl p-8">
			<Stack gap="xl">
				<Stack gap="xs">
					<Heading level={1}>Design tokens</Heading>
					<Text tone="muted">
						One direction, three layers. A component reads the semantic name and never
						the value behind it.
					</Text>
				</Stack>
				<div className="grid gap-4 md:grid-cols-3">
					{layers.map((layer) => (
						<Card key={layer.name}>
							<CardHeader>
								<CardTitle>{layer.name}</CardTitle>
								<CardDescription>
									<Code>{layer.example}</Code>
								</CardDescription>
							</CardHeader>
							<CardContent>
								<Text size="sm" tone="muted">
									{layer.what}
								</Text>
							</CardContent>
						</Card>
					))}
				</div>
				<Stack gap="sm">
					<Heading level={3}>What does not resolve</Heading>
					<Text size="sm" tone="muted">
						No default scales are registered. These classes produce no CSS, and the ones
						the theme cannot stop — an arbitrary value — fail the check.
					</Text>
					<div className="flex flex-wrap gap-2">
						{rejected.map((name) => (
							<Badge key={name} variant="outline" tone="danger">
								{name}
							</Badge>
						))}
					</div>
				</Stack>
				<Stack gap="sm">
					<Heading level={3}>Where the rules live</Heading>
					<Text size="sm" tone="muted">
						The primitives are in ui/src/styles/tokens.css, the mapping in its
						globals.css, and the check in ui/scripts/check-system.ts, which make lint
						runs. ADR 0016 records why.
					</Text>
				</Stack>
			</Stack>
		</div>
	),
};
