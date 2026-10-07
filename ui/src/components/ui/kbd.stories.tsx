import type { Meta, StoryObj } from "@storybook/react-vite";
import { Kbd, KbdGroup } from "./kbd";

const meta = {
	title: "UI/Kbd",
	component: Kbd,
	parameters: { layout: "centered" },
} satisfies Meta<typeof Kbd>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = { args: { children: "↵" } };

export const Shortcut: Story = {
	args: {},
	render: () => (
		<KbdGroup>
			<Kbd>⌘</Kbd>
			<Kbd>K</Kbd>
		</KbdGroup>
	),
};
