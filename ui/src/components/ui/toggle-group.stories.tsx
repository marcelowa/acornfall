import type { Meta, StoryObj } from "@storybook/react-vite";
import { ToggleGroup, ToggleGroupItem } from "./toggle-group";

const meta = {
	title: "UI/ToggleGroup",
	component: ToggleGroup,
	parameters: { layout: "centered" },
} satisfies Meta<typeof ToggleGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
	args: { type: "single" },
	render: () => (
		<ToggleGroup type="single" defaultValue="formatted" variant="outline">
			<ToggleGroupItem value="formatted">Formatted</ToggleGroupItem>
			<ToggleGroupItem value="raw">Raw</ToggleGroupItem>
		</ToggleGroup>
	),
};

export const Spaced: Story = {
	args: { type: "single" },
	render: () => (
		<ToggleGroup type="single" defaultValue="medium" variant="outline" spacing={2}>
			<ToggleGroupItem value="low">Low</ToggleGroupItem>
			<ToggleGroupItem value="medium">Medium</ToggleGroupItem>
			<ToggleGroupItem value="high">High</ToggleGroupItem>
		</ToggleGroup>
	),
};
