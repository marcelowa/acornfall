import type { Meta, StoryObj } from "@storybook/react-vite";
import { SlashMenu } from "./slash-menu";

const meta = {
	title: "Composer/SlashMenu",
	component: SlashMenu,
	parameters: { layout: "centered" },
} satisfies Meta<typeof SlashMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = (): void => undefined;

export const Commands: Story = {
	args: {
		commands: [
			{ name: "compact", description: "Compact the context now", source: "builtin" },
			{
				name: "review",
				description: "Review the current diff with fresh eyes",
				source: "workspace",
				argumentHint: "[paths]",
			},
			{ name: "clear", description: "Start a fresh context", source: "builtin" },
		],
		onSelect: noop,
	},
};

export const Empty: Story = {
	args: { commands: [], onSelect: noop },
};
