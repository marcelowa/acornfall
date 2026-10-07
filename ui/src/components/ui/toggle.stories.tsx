import type { Meta, StoryObj } from "@storybook/react-vite";
import { Toggle } from "./toggle";

const meta = {
	title: "UI/Toggle",
	component: Toggle,
	parameters: { layout: "centered" },
} satisfies Meta<typeof Toggle>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { children: "Formatted" } };
export const Pressed: Story = { args: { children: "Formatted", defaultPressed: true } };
export const Outline: Story = {
	args: { children: "Formatted", variant: "outline" },
};
export const Sizes: Story = {
	args: {},
	render: () => (
		<div className="flex items-center gap-3">
			<Toggle size="sm">sm</Toggle>
			<Toggle>default</Toggle>
			<Toggle size="lg">lg</Toggle>
		</div>
	),
};
