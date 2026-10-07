import type { Meta, StoryObj } from "@storybook/react-vite";
import { Input } from "./input";

const meta = {
	title: "UI/Input",
	component: Input,
	parameters: { layout: "centered" },
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
	args: { placeholder: "Search conversations" },
};

export const Sizes: Story = {
	args: {},
	render: () => (
		<div className="flex w-72 flex-col gap-3">
			<Input inputSize="sm" placeholder="Small" />
			<Input placeholder="Default" />
			<Input inputSize="lg" placeholder="Large" />
		</div>
	),
};

export const Filled: Story = {
	args: { defaultValue: "provider/model" },
};

export const Invalid: Story = {
	args: { defaultValue: "not-a-model", "aria-invalid": true },
};

export const Disabled: Story = {
	args: { placeholder: "Disabled", disabled: true },
};
