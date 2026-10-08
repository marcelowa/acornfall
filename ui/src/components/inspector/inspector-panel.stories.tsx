import type { Meta, StoryObj } from "@storybook/react-vite";
import { Text } from "@/components/typography/text";
import { InspectorPanel } from "./inspector-panel";
import type { InspectorSection } from "./inspector";

const meta = {
	title: "Conversation/InspectorPanel",
	component: InspectorPanel,
	parameters: { layout: "fullscreen" },
	decorators: [
		(Story) => (
			<div className="mx-auto flex w-full max-w-page bg-background" style={{ height: 560 }}>
				<div className="min-w-0 flex-1 p-8">
					<Text tone="muted">The transcript the panel sits beside.</Text>
				</div>
				<div style={{ width: "var(--inspector-width)" }}>
					<Story />
				</div>
			</div>
		),
	],
} satisfies Meta<typeof InspectorPanel>;

export default meta;
type Story = StoryObj<typeof meta>;

const sections: InspectorSection[] = [
	{
		key: "context",
		title: "Context",
		hint: "7 sections · 5 tools",
		body: <Text size="sm">The prompt after every patch folded in.</Text>,
	},
	{
		key: "agent",
		title: "Agent",
		hint: "general",
		body: <Text size="sm">Which layer contributed what.</Text>,
	},
	{
		key: "run",
		title: "Run",
		hint: "idle",
		body: <Text size="sm">Attempt, tools, queue.</Text>,
	},
	{
		key: "sandbox",
		title: "Sandbox",
		hint: "microsandbox 0.7.7 · running",
		body: <Text size="sm">Where the tools actually run.</Text>,
	},
];

/** The docked form at 2xl: the same sections, beside the transcript instead of over it. */
export const Docked: Story = {
	args: { sections },
};
