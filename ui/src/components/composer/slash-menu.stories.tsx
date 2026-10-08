import type { Meta, StoryObj } from "@storybook/react-vite";
import { SlashMenu } from "./slash-menu";

const meta = {
	title: "Conversation/SlashMenu",
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

/** The keyboard highlight; hover syncs it. */
export const Highlighted: Story = {
	args: {
		...Commands.args,
		highlighted: 1,
	},
};

/** More than a screen of matches: the menu caps at eight and says so. */
export const Overflow: Story = {
	args: {
		commands: Array.from({ length: 12 }, (_, index) => ({
			name: `command-${index}`,
			description: `Does thing number ${index}`,
			source: "builtin",
		})),
		onSelect: noop,
	},
};
