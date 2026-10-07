import type { Meta, StoryObj } from "@storybook/react-vite";
import { StatusDot } from "./status-dot";

const meta = {
	title: "UI/StatusDot",
	component: StatusDot,
	parameters: { layout: "centered" },
} satisfies Meta<typeof StatusDot>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Running: Story = { args: { state: "running" } };
export const Unread: Story = { args: { state: "unread" } };

export const Sizes: Story = {
	args: {},
	render: () => (
		<div className="flex items-center gap-6">
			<StatusDot state="running" size="sm" />
			<StatusDot state="running" />
			<StatusDot state="unread" size="sm" />
			<StatusDot state="unread" />
		</div>
	),
};
