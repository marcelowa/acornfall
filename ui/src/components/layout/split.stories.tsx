import type { Meta, StoryObj } from "@storybook/react-vite";
import { Split } from "./split";
import { Stack } from "./stack";
import { Text } from "../typography/text";

const meta = {
	title: "Layout/Split",
	component: Split,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Split>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Rail: Story = {
	args: {
		aside: (
			<Stack gap="sm" padding="md" fill className="border-r border-border bg-card">
				<Text weight="semibold">The rail</Text>
				<Text size="sm" tone="muted">
					Fixed at --rail-width.
				</Text>
			</Stack>
		),
		children: (
			<Stack gap="sm" padding="lg" fill>
				<Text weight="semibold">The pane beside it</Text>
				<Text size="sm" tone="muted">
					The rest of the width, and the only part that grows.
				</Text>
			</Stack>
		),
	},
	render: (args) => (
		<div className="h-full">
			<Split {...args} />
		</div>
	),
};
