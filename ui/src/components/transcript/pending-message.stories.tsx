import type { Meta, StoryObj } from "@storybook/react-vite";
import { PendingMessage } from "./pending-message";

const meta = {
	title: "Conversation/PendingMessage",
	component: PendingMessage,
	parameters: { layout: "centered" },
	decorators: [
		(Story) => (
			<div className="flex w-96 flex-col bg-background p-4">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof PendingMessage>;

export default meta;
type Story = StoryObj<typeof meta>;

/** It joins the turn that is running. */
export const Steering: Story = {
	args: {
		entry: {
			kind: "pending",
			id: "pending-1",
			text: "wait, check the lock order first",
			action: "steer",
		},
	},
};

/** It waits behind the turn that is running. */
export const Queued: Story = {
	args: {
		entry: {
			kind: "pending",
			id: "pending-2",
			text: "then update the changelog",
			action: "followUp",
		},
	},
};
