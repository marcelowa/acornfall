import type { Meta, StoryObj } from "@storybook/react-vite";
import { RenameDialog } from "./rename-dialog";

const meta = {
	title: "UI/Rename dialog",
	component: RenameDialog,
	parameters: { layout: "centered" },
} satisfies Meta<typeof RenameDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = (): void => undefined;

/** Open on a conversation: the field starts with the name it has. */
export const RenamingAConversation: Story = {
	args: {
		open: true,
		title: "Rename conversation",
		initial: "The stream sends state views",
		onSave: noop,
		onCancel: noop,
	},
};

/** The same dialog on a workspace, which is the other thing in this interface with a name. */
export const RenamingAWorkspace: Story = {
	args: {
		open: true,
		title: "Rename workspace",
		initial: "acornfall",
		onSave: noop,
		onCancel: noop,
	},
};

/** Closed, which is what the app renders when nothing is being renamed. */
export const Closed: Story = {
	args: {
		open: false,
		title: "Rename conversation",
		initial: "",
		onSave: noop,
		onCancel: noop,
	},
};
