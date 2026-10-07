import type { Meta, StoryObj } from "@storybook/react-vite";
import { Stack } from "./stack";
import { Text } from "../typography/text";

const meta = {
	title: "Layout/Stack",
	component: Stack,
	parameters: { layout: "centered" },
} satisfies Meta<typeof Stack>;

export default meta;
type Story = StoryObj<typeof meta>;

function Box({ label }: { label: string }) {
	return (
		<div className="rounded-md bg-secondary px-4 py-2">
			<Text size="sm">{label}</Text>
		</div>
	);
}

export const Vertical: Story = {
	args: {
		gap: "sm",
		children: (
			<>
				<Box label="One" />
				<Box label="Two" />
				<Box label="Three" />
			</>
		),
	},
};

export const Horizontal: Story = {
	args: {
		direction: "horizontal",
		gap: "md",
		align: "center",
		children: (
			<>
				<Box label="One" />
				<Box label="Two" />
				<Box label="Three" />
			</>
		),
	},
};

export const Between: Story = {
	args: {
		direction: "horizontal",
		justify: "between",
		align: "center",
		children: (
			<>
				<Box label="Left" />
				<Box label="Right" />
			</>
		),
	},
	render: (args) => (
		<div className="w-full max-w-lg">
			<Stack {...args} />
		</div>
	),
};
