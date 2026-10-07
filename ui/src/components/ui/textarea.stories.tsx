import type { Meta, StoryObj } from "@storybook/react-vite";
import { Textarea } from "./textarea";

const meta = {
	title: "UI/Textarea",
	component: Textarea,
	parameters: { layout: "centered" },
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
	args: { placeholder: "Send a message", className: "w-80" },
};

export const Invalid: Story = {
	args: { defaultValue: "   ", "aria-invalid": true, className: "w-80" },
};

export const Disabled: Story = {
	args: { placeholder: "Disabled", disabled: true, className: "w-80" },
};
