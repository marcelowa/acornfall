import type { Meta, StoryObj } from "@storybook/react-vite";
import { ThemeToggle } from "./theme-toggle";

const meta = {
	title: "UI/ThemeToggle",
	component: ThemeToggle,
	parameters: { layout: "centered" },
} satisfies Meta<typeof ThemeToggle>;

export default meta;
type Story = StoryObj<typeof meta>;

const noop = () => undefined;

export const Light: Story = { args: { theme: "light", onToggle: noop } };
export const Dark: Story = { args: { theme: "dark", onToggle: noop } };
