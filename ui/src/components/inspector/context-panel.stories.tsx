import type { Meta, StoryObj } from "@storybook/react-vite";
import { foldContext } from "@/app/context";
import type { WireEntry } from "@/app/wire";
import { ContextPanel } from "./context-panel";

const meta = {
	title: "Inspector/ContextPanel",
	component: ContextPanel,
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story) => (
			<div className="h-full w-96 bg-card p-2">
				<Story />
			</div>
		),
	],
} satisfies Meta<typeof ContextPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

const entries: WireEntry[] = [
	{
		id: 10,
		kind: "pi.system",
		model: [
			{
				content: "",
				sections: {
					preamble: "You are a careful engineer.",
					cwd: "<cwd>\n/acornfall\n</cwd>",
					skills: "deslop: simplify the work just completed",
				},
				toolsAdded: [
					{ name: "read", description: "read a file", parameters: { type: "object" } },
					{ name: "bash", description: "run a command", parameters: { type: "object" } },
				],
			},
		],
	},
	{
		id: 71,
		kind: "pi.system",
		model: [{ content: "", sections: { instructions: "global + workspace + agent" } }],
	},
	{
		id: 92,
		kind: "pi.system",
		model: [
			{
				content: "",
				sections: { instructions: "edited by the agent definition" },
				toolsAdded: [
					{ name: "edit", description: "edit a file", parameters: { type: "object" } },
				],
				toolsRemoved: [{ name: "bash" }],
			},
		],
	},
	{
		id: 93,
		kind: "pi.assistant",
		model: [
			{ content: "…", usage: { input: 12400, output: 320, cacheRead: 8000, cacheWrite: 0 } },
		],
	},
];

export const Latest: Story = {
	args: {
		requests: foldContext(entries),
		usage: { input: 12400, output: 320, cacheRead: 8000, cacheWrite: 0 },
	},
};

export const Empty: Story = {
	args: { requests: [] },
};
