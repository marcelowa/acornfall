import type { Meta, StoryObj } from "@storybook/react-vite";
import { Text } from "@/components/typography/text";
import { Inspector, type InspectorSection } from "./inspector";

const meta = {
	title: "Inspector/Inspector",
	component: Inspector,
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof Inspector>;

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

/** The overlay closed: what the interface shows is the toggle in the top-right corner. */
export const Closed: Story = {
	args: { sections },
};

/**
 * Open: the whole screen, every section readable at once. The catalogue needs a story of the
 * open state, so this one starts open — the app never passes this.
 */
export const Open: Story = {
	args: { sections, defaultOpen: true },
};

/** The catalogue's other state: a reader who put one section away while reading another. */
export const SectionPutAway: Story = {
	args: { sections, defaultOpen: true },
	play: async ({ canvasElement }) => {
		const button = canvasElement.querySelector<HTMLButtonElement>(
			'[data-section="agent"] button[aria-expanded]',
		);
		button?.click();
	},
};
