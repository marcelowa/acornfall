import type { Meta, StoryObj } from "@storybook/react-vite";
import { WorkspaceList } from "./workspace-list";

const meta = {
	title: "Workspace/WorkspaceList",
	component: WorkspaceList,
	parameters: { layout: "centered" },
	decorators: [
		(Story) => (
			<div className="w-80 bg-card p-2">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof WorkspaceList>;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = (): void => undefined;

export const Several: Story = {
	args: {
		workspaces: [
			{
				name: "general",
				title: "acornfall",
				path: "/home/marcelo/workspace/acornfall",
				general: true,
				running: true,
				active: true,
			},
			{
				name: "sandboxed",
				title: "Pinned environment",
				path: "/home/marcelo/acornfall/workspaces/sandboxed",
				general: false,
				running: false,
				active: false,
				image: "ghcr.io/acornfall/sandbox:node-24",
				network: "off",
			},
			{
				name: "foobar",
				title: "foobar",
				path: "/home/marcelo/acornfall/workspaces/foobar",
				general: false,
				running: false,
				active: false,
			},
		],
		onSelect: noop,
	},
};

export const One: Story = {
	args: {
		workspaces: [
			{
				name: "general",
				title: "acornfall",
				path: "/home/marcelo/workspace/acornfall",
				general: true,
				running: true,
				active: true,
			},
		],
		onSelect: noop,
	},
};
