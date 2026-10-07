import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "@/components/layout/stack";
import { Code } from "@/components/typography/code";
import { Heading } from "@/components/typography/heading";
import { Text } from "@/components/typography/text";

const meta = {
	title: "Foundations/Spacing",
	parameters: {
		layout: "fullscreen",
		docs: {
			description: {
				story: "The 4px grid, and every step named. The halves exist because a 2px inset is real in dense UI; nothing else is on offer. Tailwind's dynamic spacer is off, so this list is the whole vocabulary — p-13 is not a smaller step, it is not a step.",
			},
		},
	},
	tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

const steps = [
	"0",
	"0.5",
	"1",
	"1.5",
	"2",
	"2.5",
	"3",
	"3.5",
	"4",
	"5",
	"6",
	"7",
	"8",
	"9",
	"10",
	"11",
	"12",
	"14",
	"16",
	"20",
	"24",
	"32",
];

export const Spacing: Story = {
	render: () => (
		<div className="mx-auto w-full max-w-3xl p-8">
			<Stack gap="xl">
				<Stack gap="xs">
					<Heading level={1}>Spacing</Heading>
					<Text tone="muted">
						Padding, margin, gap, width, and height all draw from these steps: p-4,
						gap-4, size-4, h-9.
					</Text>
				</Stack>
				<Stack gap="sm">
					{steps.map((step) => (
						<div key={step} className="flex items-center gap-4">
							<Code className="w-10 shrink-0">{step}</Code>
							<div className="flex w-full items-center">
								<div
									className="h-3 rounded-sm bg-primary"
									style={{ width: "var(--spacing-" + step + ")" }}
								/>
							</div>
						</div>
					))}
				</Stack>
			</Stack>
		</div>
	),
};
