import type { Meta, StoryObj } from "@storybook/react-vite";
import { Separator } from "./separator";
import { Text } from "../typography/text";

const meta = {
	title: "UI/Separator",
	component: Separator,
	parameters: { layout: "centered" },
} satisfies Meta<typeof Separator>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Horizontal: Story = {
	args: {},
	render: () => (
		<div className="w-64">
			<Text size="sm">Above</Text>
			<Separator className="my-3" />
			<Text size="sm">Below</Text>
		</div>
	),
};

export const Vertical: Story = {
	args: {},
	render: () => (
		<div className="flex h-8 items-center gap-3">
			<Text size="sm">rail</Text>
			<Separator orientation="vertical" />
			<Text size="sm">transcript</Text>
		</div>
	),
};
