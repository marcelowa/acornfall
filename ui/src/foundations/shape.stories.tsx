import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "@/components/layout/stack";
import { Code } from "@/components/typography/code";
import { Heading } from "@/components/typography/heading";
import { Text } from "@/components/typography/text";
import { cn } from "@/lib/utils";

const meta = {
	title: "Foundations/Shape",
	parameters: {
		layout: "fullscreen",
		docs: {
			description: {
				story: "Radius and shadow, as classes. A corner is a token step and a shadow is one of five weights — there is no sixth, and no bracket.",
			},
		},
	},
	tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const radii = [
	"rounded-xs",
	"rounded-sm",
	"rounded-md",
	"rounded-lg",
	"rounded-xl",
	"rounded-2xl",
	"rounded-full",
];
const shadows = ["shadow-2xs", "shadow-xs", "shadow-sm", "shadow-md", "shadow-lg", "shadow-xl"];

export const Shape: Story = {
	render: () => (
		<div className="mx-auto w-full max-w-3xl p-8">
			<Stack gap="xl">
				<Stack gap="xs">
					<Heading level={1}>Shape</Heading>
					<Text tone="muted">
						The two axes that make a surface read as a surface. Both are closed sets.
					</Text>
				</Stack>
				<Stack gap="md">
					<Heading level={3}>Radius</Heading>
					<div className="flex flex-wrap gap-6">
						{radii.map((name) => (
							<Stack key={name} gap="2xs" align="center">
								<div className={cn("size-20 border border-border bg-card", name)} />
								<Code>{name}</Code>
							</Stack>
						))}
					</div>
				</Stack>
				<Stack gap="md">
					<Heading level={3}>Shadow</Heading>
					<div className="flex flex-wrap gap-6">
						{shadows.map((name) => (
							<Stack key={name} gap="2xs" align="center">
								<div className={cn("size-20 rounded-lg bg-card", name)} />
								<Code>{name}</Code>
							</Stack>
						))}
					</div>
				</Stack>
			</Stack>
		</div>
	),
};
