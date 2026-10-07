import type { Meta, StoryObj } from "@storybook/react-vite";
import { Measure } from "./measure";

const meta = {
	title: "Layout/Measure",
	component: Measure,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Measure>;

export default meta;
type Story = StoryObj<typeof meta>;

const content = <div className="h-24 rounded-md bg-primary" />;

export const Prose: Story = {
	args: { size: "prose", padding: "sm", children: content },
	render: (args) => (
		<div className="h-full w-full bg-muted p-4">
			<Measure {...args} />
		</div>
	),
};

export const Page: Story = {
	args: { size: "page", padding: "sm", children: content },
	render: (args) => (
		<div className="h-full w-full bg-muted p-4">
			<Measure {...args} />
		</div>
	),
};
