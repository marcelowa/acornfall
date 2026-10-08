import type { Meta, StoryObj } from "@storybook/react-vite";
import { SandboxPanel } from "./sandbox-panel";

const meta = {
	title: "Conversation/SandboxPanel",
	component: SandboxPanel,
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story) => (
			<div className="h-full w-96 bg-card p-2">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof SandboxPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Running: Story = {
	args: {
		sandbox: {
			engine: "microsandbox",
			version: "0.7.7",
			status: "Running",
			tools: true,
			isolated: true,
		},
		workspacePath: "/home/marcelo/workspace/acornfall",
	},
};

/** The host engine is not isolation, and the interface has to say so. */
export const OnTheHost: Story = {
	args: {
		sandbox: {
			engine: "host",
			version: "",
			status: "Running",
			tools: true,
			isolated: false,
		},
	},
};

/** A sandbox that refused, with the reason it gives. */
export const Refused: Story = {
	args: {
		sandbox: {
			engine: "microsandbox",
			version: "0.7.7",
			status: "Stopped",
			tools: false,
			isolated: true,
			problem: "no hypervisor: /dev/kvm is not readable",
		},
	},
};

export const NothingYet: Story = {
	args: {},
};
