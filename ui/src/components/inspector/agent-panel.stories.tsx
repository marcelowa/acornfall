import type { Meta, StoryObj } from "@storybook/react-vite";
import { AgentPanel } from "./agent-panel";

const meta = {
	title: "Inspector/AgentPanel",
	component: AgentPanel,
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story) => (
			<div className="h-full w-96 bg-card p-2">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof AgentPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithLayers: Story = {
	args: {
		resolved: {
			name: "scout",
			source: "/home/marcelo/workspace/acornfall/.agents/agents/scout.md",
			layers: [
				{ layer: "install", path: "/home/marcelo/.acornfall/agents/default.md" },
				{ layer: "workspace", path: "/acornfall/.agents/agents/scout.md" },
				{ layer: "conversation", path: "(chosen in this conversation)" },
			],
		},
		model: "opencode-go/deepseek-v4.1-flash",
		thinking: "max",
		sandbox: "microsandbox",
		harness: "pi-durable",
	},
};

/** A level the model could not express says what was asked, instead of looking ignored. */
export const ThinkingDowngraded: Story = {
	args: {
		...WithLayers.args,
		thinking: "medium",
		thinkingRequested: "max",
	},
};

export const DefaultsOnly: Story = {
	args: {
		model: "opencode-go/deepseek-v4.1-flash",
		thinking: "medium",
	},
};
