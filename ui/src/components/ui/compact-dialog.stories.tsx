import type { Meta, StoryObj } from "@storybook/react-vite";
import { CompactDialog } from "./compact-dialog";

const meta = {
	title: "Conversation/CompactDialog",
	component: CompactDialog,
	parameters: { layout: "centered" },
} satisfies Meta<typeof CompactDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = (): void => undefined;

/** The scope, counted: turns, entries, and the last context line. */
export const Ready: Story = {
	args: {
		open: true,
		preview: { conversationId: "3", entries: 41, turns: 6 },
		contextText: "12.5k of 200k tok (6%)",
		onKeep: noop,
		onCancel: noop,
	},
};

/** Still counting: the button waits. */
export const Loading: Story = {
	args: {
		open: true,
		preview: undefined,
		onKeep: noop,
		onCancel: noop,
	},
};
