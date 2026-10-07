import type { Meta, StoryObj } from "@storybook/react-vite";
import type { WorkspaceSummary } from "@/app/view-models";
import { WorkspacesScreen } from "./workspaces-screen";

const meta = {
	title: "Components/Workspaces screen",
	component: WorkspacesScreen,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof WorkspacesScreen>;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = (): void => undefined;

const workspaces: WorkspaceSummary[] = [
	{
		name: "general",
		title: "acornfall",
		path: "/home/marcelo/workspace/acornfall",
		general: true,
		running: true,
		active: true,
	},
	{
		name: "demo",
		title: "Demo",
		path: "/home/marcelo/workspaces/demo",
		general: false,
		running: false,
		active: false,
	},
	{
		name: "something",
		title: "Something long enough to need the whole row and then some more",
		path: "/home/marcelo/workspaces/something",
		general: false,
		running: false,
		active: false,
	},
];

export const Default: Story = {
	args: {
		workspaces,
		onSelect: noop,
		onCreate: noop,
		onRename: noop,
		onForget: noop,
		onClose: noop,
	},
};

/** Nothing but the general workspace: the only row that cannot be forgotten. */
export const GeneralOnly: Story = {
	args: { ...Default.args, workspaces: workspaces.slice(0, 1) },
};
