import type { Meta, StoryObj } from "@storybook/react-vite";
import { CopyButton } from "./copy-button";

const meta = {
	title: "UI/CopyButton",
	component: CopyButton,
	parameters: { layout: "centered" },
} satisfies Meta<typeof CopyButton>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
	args: { value: "provider/model · medium · default agent" },
};

export const CustomLabel: Story = {
	args: { value: "the whole markdown source", label: "Copy source" },
};
