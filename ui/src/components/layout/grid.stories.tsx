import type { Meta, StoryObj } from "@storybook/react-vite";
import { Grid } from "./grid";
import { Text } from "../typography/text";

const meta = {
	title: "Layout/Grid",
	component: Grid,
	parameters: { layout: "centered" },
} satisfies Meta<typeof Grid>;

export default meta;
type Story = StoryObj<typeof meta>;

const cells = ["One", "Two", "Three", "Four"];

export const TwoColumns: Story = {
	args: {
		columns: "2",
		children: cells.map((cell) => (
			<div key={cell} className="rounded-md bg-secondary px-4 py-2">
				<Text size="sm">{cell}</Text>
			</div>
		)),
	},
	render: (args) => (
		<div className="w-full max-w-lg">
			<Grid {...args} />
		</div>
	),
};

export const FourColumns: Story = {
	args: {
		columns: "4",
		gap: "sm",
		children: cells.map((cell) => (
			<div key={cell} className="rounded-md bg-secondary px-4 py-2">
				<Text size="sm">{cell}</Text>
			</div>
		)),
	},
	render: (args) => (
		<div className="w-full max-w-2xl">
			<Grid {...args} />
		</div>
	),
};
