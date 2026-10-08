import type { Meta, StoryObj } from "@storybook/react-vite";
import { RunPanel } from "./run-panel";

const meta = {
	title: "Conversation/RunPanel",
	component: RunPanel,
	parameters: { layout: "centered" },
	decorators: [
		(Story) => (
			<div className="w-80 rounded-md border border-border bg-background p-4">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof RunPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Idle: Story = {
	args: { running: false, queued: 0, model: "Opus 5", thinking: "medium" },
};

export const Running: Story = {
	args: { running: true, queued: 2, model: "Opus 5", thinking: "max" },
};
