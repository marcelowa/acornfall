import type { Meta, StoryObj } from "@storybook/react-vite";
import type { WorkspaceSummary } from "@/app/view-models";
import { SandboxDialog } from "./sandbox-dialog";

const meta = {
	title: "UI/SandboxDialog",
	component: SandboxDialog,
	parameters: { layout: "centered" },
} satisfies Meta<typeof SandboxDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = (): void => undefined;

const workspace: WorkspaceSummary = {
	name: "acornfall",
	title: "acornfall",
	path: "/home/marcelo/acornfall/workspaces/acronfall",
	general: true,
	running: true,
	active: true,
	image: "acornfall/sandbox:0.7.6",
	network: "on",
};

/**
 * Opened from a row's own menu on the workspaces screen, which is where a workspace is named:
 * this is the only place the sandbox's image and network are set, since the Settings screen no
 * longer answers for whichever workspace happened to be in view.
 */
export const Open: Story = {
	args: { workspace, onSave: noop, onClose: noop },
};

/** A refusal lands beside the value that was refused, in the server's own words. */
export const Refused: Story = {
	args: {
		workspace,
		failure: "no image by that name on this host",
		onSave: noop,
		onClose: noop,
	},
};

/** A workspace with nothing chosen yet: the placeholder is the engine's own default. */
export const NoImageYet: Story = {
	args: {
		workspace: { ...workspace, image: "", network: "off" },
		onSave: noop,
		onClose: noop,
	},
};
