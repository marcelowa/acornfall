import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "@/components/layout/stack";
import { Code } from "@/components/typography/code";
import { Heading } from "@/components/typography/heading";
import { Text } from "@/components/typography/text";

const meta = {
	title: "Foundations/Palette",
	parameters: {
		layout: "fullscreen",
		docs: {
			description: {
				story: [
					"The primitive layer: the ramps the semantic layer picks from. **These are not for components.** No utility resolves to one — there is no bg-brand-500 — and this page reads them with var(--base-*) to display them, which is the only place the design-system check allows that.",
					"Change a ramp here and every semantic name that points at it moves. Nothing else should.",
				].join("\n\n"),
			},
		},
	},
	tags: ["autodocs"],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

interface Ramp {
	name: string;
	steps: string[];
}

const ramps: Ramp[] = [
	{
		name: "neutral",
		steps: [
			"0",
			"50",
			"100",
			"200",
			"300",
			"400",
			"500",
			"600",
			"700",
			"800",
			"850",
			"875",
			"900",
			"950",
		],
	},
	{
		name: "brand",
		steps: ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"],
	},
	{
		name: "secondary",
		steps: ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"],
	},
	{
		name: "success",
		steps: ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"],
	},
	{
		name: "warning",
		steps: ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"],
	},
	{
		name: "danger",
		steps: ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"],
	},
	{
		name: "info",
		steps: ["50", "100", "200", "300", "400", "500", "600", "700", "800", "900", "950"],
	},
];

export const Palette: Story = {
	render: () => (
		<div className="mx-auto w-full max-w-4xl p-8">
			<Stack gap="xl">
				<Stack gap="xs">
					<Heading level={1}>Palette</Heading>
					<Text tone="muted">
						The primitives behind the semantic layer. No class resolves to one of these,
						and no component should read one.
					</Text>
				</Stack>
				{ramps.map((ramp) => (
					<Stack key={ramp.name} gap="xs">
						<Code>--base-{ramp.name}-*</Code>
						<div className="flex">
							{ramp.steps.map((step) => (
								<div key={step} className="flex flex-1 flex-col items-center gap-1">
									<div
										className="h-14 w-full"
										style={{
											backgroundColor:
												"var(--base-" + ramp.name + "-" + step + ")",
										}}
									/>
									<Text size="2xs" tone="muted">
										{step}
									</Text>
								</div>
							))}
						</div>
					</Stack>
				))}
			</Stack>
		</div>
	),
};
